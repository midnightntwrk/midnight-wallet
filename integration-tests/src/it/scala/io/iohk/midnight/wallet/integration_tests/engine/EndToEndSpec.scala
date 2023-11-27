package io.iohk.midnight.wallet.integration_tests.engine

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.effect.std.Queue
import cats.syntax.all.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.Wallet.Snapshot
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.{AllocatedWallet, WalletDependencies}
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.zswap.*
import munit.CatsEffectSuite
import scala.concurrent.duration.*
import sttp.client3.UriContext

trait EndToEndSpecSetup {
  val indexerRPCUri = uri"http://localhost:8088/api/graphql"
  val indexerWSUri = uri"ws://localhost:8088/api/graphql/ws"
  val proverServerUri = uri"http://localhost:6300"
  val substrateNodeUri = uri"http://localhost:9933"
  val tokenType = TokenType.Native
  val coin = CoinInfo(tokenType, BigInt(1_000_000))
  val spendCoin = CoinInfo(tokenType, BigInt(10_000))
  def randomRecipient(): Address = {
    val localState = LocalState()
    Address(localState.coinPublicKey, localState.encryptionPublicKey)
  }

  def prepareOutputs(coins: List[CoinInfo], recipient: Address): List[domain.TokenTransfer] = {
    coins.map { coin =>
      domain.TokenTransfer(coin.value, coin.tokenType, domain.Address(recipient.asString))
    }
  }

  def prepareStateWithCoins(coins: List[CoinInfo]): LocalState = {
    def applyCoinToState(coin: CoinInfo, state: LocalState): LocalState = {
      val output = UnprovenOutput(coin, state.coinPublicKey, state.encryptionPublicKey)
      val offer = UnprovenOffer.fromOutput(output, coin.tokenType, coin.value)
      state
        .watchFor(coin)
        .applyProofErased(UnprovenTransaction(offer).eraseProofs.guaranteedCoins)
    }
    val state = LocalState()
    coins
      .foldLeft(state) { case (accState, coin) =>
        applyCoinToState(coin, accState)
      }
  }

  def makeRunningWalletResource(
      initialState: Snapshot,
  ): Resource[IO, AllocatedWallet[IO, Wallet]] =
    Resource.make(
      Wallet
        .build[IO](
          Config(
            indexerRPCUri,
            indexerWSUri,
            proverServerUri,
            substrateNodeUri,
            LogLevel.Info,
            initialState,
          ),
        )
        .flatTap(_.dependencies.walletSyncService.updates.compile.drain.start),
    )(_.finalizer)

  def withRunningWallet(initialWalletState: Snapshot)(
      body: AllocatedWallet[IO, Wallet] => IO[Unit],
  ): IO[Unit] =
    makeRunningWalletResource(initialWalletState)
      .use(body(_))

  def makeWalletResource(
      initialState: Snapshot,
  ): Resource[IO, AllocatedWallet[IO, Wallet]] = {
    Resource.make(
      Wallet
        .build[IO](
          Config(
            indexerRPCUri,
            indexerWSUri,
            proverServerUri,
            substrateNodeUri,
            LogLevel.Info,
            initialState,
          ),
        ),
    )(_.finalizer)
  }

  def withWallet(initialWalletState: Snapshot)(
      body: AllocatedWallet[IO, Wallet] => IO[Unit],
  ): IO[Unit] =
    makeWalletResource(initialWalletState)
      .use(body(_))
}

@SuppressWarnings(Array("org.wartremover.warts.TryPartial", "org.wartremover.warts.SeqApply"))
class EndToEndSpec extends CatsEffectSuite with EndToEndSpecSetup {

  override val munitIOTimeout: Duration = 2.minutes

  test("Submit tx and sync".ignore) {
    val initialState =
      Snapshot
        .fromSeed("0000000000000000000000000000000000000000000000000000000000000042")
        .toTry
        .get

    withRunningWallet(initialState) {
      case AllocatedWallet(
            WalletDependencies(_, walletState, txSubmission, walletTransactionService),
            _,
          ) =>
        val initialSync =
          walletState.state
            .find(s => s.syncProgress.exists(p => p.synced.value === p.total.value))
            .map(_.balances.getOrElse(tokenType, BigInt(0)))
            .compile
            .lastOrError

        val sendTx =
          walletTransactionService
            .prepareTransferRecipe(
              prepareOutputs(List(CoinInfo(tokenType, BigInt(100_000))), randomRecipient()),
            )
            .flatMap(walletTransactionService.proveTransaction)
            .flatMap(txSubmission.submitTransaction)

        val waitConfirmation =
          walletState.state
            .find(s => s.coins.size === s.availableCoins.size)
            .map(_.balances.getOrElse(tokenType, BigInt(0)))
            .compile
            .lastOrError

        val init = for {
          _ <- IO.println("Syncing...")
          balance <- initialSync
          _ <- IO.println(s"Synced. Initial balance: $balance")
        } yield ()

        val sendAndWait = for {
          _ <- IO.println("Sending tx...")
          _ <- sendTx
          _ <- IO.println("Tx sent. Waiting for confirmation...")
          balance <- waitConfirmation
          _ <- IO.println(s"Confirmed. Balance left: $balance")
        } yield ()

        init >> sendAndWait.foreverM
    }
  }

  // Turn off the proof server for this test
  test("Recover balance after failed call to proof server".ignore) {
    val initialState =
      Snapshot
        .fromSeed("0000000000000000000000000000000000000000000000000000000000000042")
        .toTry
        .get

    val initialBalance = BigInt("25000000000000000")

    withRunningWallet(initialState) {
      case AllocatedWallet(
            WalletDependencies(_, walletState, txSubmission, walletTransactionService),
            _,
          ) =>
        for {
          _ <- walletState.state
            .evalTap(s => IO.println(s"Balance: ${s.balances.getOrElse(TokenType.Native, 0)}"))
            .find(_.balances.getOrElse(TokenType.Native, BigInt(0)) === initialBalance)
            .compile
            .drain
          transferRecipe <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(CoinInfo(tokenType, BigInt(1_000_000))), randomRecipient()),
          )
          _ <- walletTransactionService.proveTransaction(transferRecipe).attempt
          balanceAfterProof <-
            walletState.state
              .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
              .evalTap(balance => IO.println(s"Balance: $balance"))
              .head
              .compile
              .lastOrError
          _ <- IO.println("Sleeping for 10 seconds. Turn proof server on.")
          _ <- IO.sleep(10.seconds)
          _ <- IO.println("Proving transaction")
          transferRecipe2 <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(CoinInfo(tokenType, BigInt(1_000_000))), randomRecipient()),
          )
          txToSubmit <- walletTransactionService.proveTransaction(transferRecipe2)
          _ <- IO.println("Submitting transaction")
          _ <- txSubmission.submitTransaction(txToSubmit)
          _ <- IO.println("Transaction submitted")
          balancesAfterSubmission <-
            walletState.state
              .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
              .evalTap(balance => IO.println(s"Balance: $balance"))
              .take(2)
              .compile
              .toList
        } yield {
          assertEquals(balanceAfterProof, initialBalance)
          assert(balancesAfterSubmission(0) < initialBalance)
          assert(balancesAfterSubmission(1) < initialBalance)
          assert(balancesAfterSubmission(0) < balancesAfterSubmission(1))
        }
    }
  }

  // Turn off the node for this test
  test("Recover balance after failed call to submit tx".ignore) {
    val initialState =
      Snapshot
        .fromSeed("0000000000000000000000000000000000000000000000000000000000000042")
        .toTry
        .get

    val initialBalance = BigInt("25000000000000000")

    withRunningWallet(initialState) {
      case AllocatedWallet(
            WalletDependencies(_, walletState, txSubmission, walletTransactionService),
            _,
          ) =>
        for {
          _ <- walletState.state
            .evalTap(s => IO.println(s"Balance: ${s.balances.getOrElse(TokenType.Native, 0)}"))
            .map(_.syncProgress)
            .flattenOption
            .find(s => s.synced.value === s.total.value)
            .compile
            .drain
          transferRecipe <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(CoinInfo(tokenType, BigInt(1_000_000))), randomRecipient()),
          )
          txToSubmit <- walletTransactionService.proveTransaction(transferRecipe)
          balanceAfterProof <-
            walletState.state
              .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
              .evalTap(balance => IO.println(s"Balance: $balance"))
              .head
              .compile
              .lastOrError
          _ <- txSubmission.submitTransaction(txToSubmit).attempt
          balanceAfterSubmission <-
            walletState.state
              .evalTap(state => IO.println(s"Coins: ${state.coins.map(_.value)}"))
              .evalTap(state =>
                IO.println(s"Available coins: ${state.availableCoins.map(_.value)}"),
              )
              .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
              .evalTap(balance => IO.println(s"Balance: $balance"))
              .head
              .compile
              .lastOrError
        } yield {
          assertEquals(balanceAfterSubmission, initialBalance)
          assert(balanceAfterProof < initialBalance)
        }
    }
  }

  test(
    "Submit tx one after another with waiting for blocks apply and doesn't spend the same coin (no double spend)".ignore,
  ) {
    val initialState = Snapshot(prepareStateWithCoins(List(coin)), Seq.empty, None)

    withWallet(initialState) {
      case AllocatedWallet(
            WalletDependencies(
              walletSyncService,
              walletState,
              txSubmission,
              walletTransactionService,
            ),
            _,
          ) =>
        for {
          appliedUpdatesQueue <- Queue.unbounded[IO, domain.IndexerUpdate]
          _ <- walletSyncService.updates
            .collect { case Right(value) => value }
            .enqueueUnterminated(appliedUpdatesQueue)
            .compile
            .drain
            .start
          _ <- appliedUpdatesQueue.take
          balanceBeforeSend <- walletState.state
            .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
            .find(_ >= coin.value)
            .compile
            .lastOrError
          firstTransferRecipe <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(spendCoin), randomRecipient()),
          )
          firstSpendTx <- walletTransactionService.proveTransaction(firstTransferRecipe)
          _ <- txSubmission.submitTransaction(firstSpendTx)
          _ <- appliedUpdatesQueue.take
          balanceAfter1Send <- walletState.state
            .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
            .find(_ < coin.value)
            .compile
            .lastOrError
          secondTransferRecipe <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(spendCoin), randomRecipient()),
          )
          secondSpendTx <- walletTransactionService.proveTransaction(secondTransferRecipe)
          _ <- txSubmission.submitTransaction(secondSpendTx)
          _ <- appliedUpdatesQueue.take
          balanceAfter2Send <- walletState.state
            .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
            .find(_ < coin.value)
            .compile
            .lastOrError
        } yield {
          assertEquals(balanceBeforeSend, coin.value)
          assertEquals(balanceAfter1Send, coin.value - spendCoin.value)
          assertEquals(balanceAfter2Send, balanceAfter1Send - spendCoin.value)
        }
    }
  }

  test(
    "Prepare transfer tx one after another and doesn't spend the same coin (no double spend)".ignore,
  ) {
    val initialState = Snapshot(prepareStateWithCoins(List(coin)), Seq.empty, None)

    val quickTxSend = withWallet(initialState) {
      case AllocatedWallet(
            WalletDependencies(
              walletSyncService,
              _,
              txSubmission,
              walletTransactionService,
            ),
            _,
          ) =>
        for {
          _ <- walletSyncService.updates.take(1).compile.toList
          firstTransferRecipe <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(spendCoin), randomRecipient()),
          )
          firstSpendTx <- walletTransactionService.proveTransaction(firstTransferRecipe)
          firstTxResult <- txSubmission.submitTransaction(firstSpendTx).attempt
          _ <-
            if (firstTxResult.isRight) {
              for {
                secondTransferRecipe <- walletTransactionService.prepareTransferRecipe(
                  prepareOutputs(List(spendCoin), randomRecipient()),
                )
                secondSpendTx <- walletTransactionService.proveTransaction(secondTransferRecipe)
              } yield txSubmission.submitTransaction(secondSpendTx)
            } else fail("Submitting first transaction has failed")
        } yield ()
    }

    interceptMessageIO[Throwable]("Not sufficient funds to balance the cost of transaction")(
      quickTxSend,
    )
  }
}
