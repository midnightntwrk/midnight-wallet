package io.iohk.midnight.wallet.integration_tests.engine

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.effect.std.Queue
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.domain.{Address, TokenTransfer, ViewingUpdate}
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
  def randomRecipient(): CoinPublicKey = LocalState().coinPublicKey

  def prepareOutputs(coins: List[CoinInfo], recipient: CoinPublicKey): List[TokenTransfer] = {
    coins.map { coin =>
      TokenTransfer(coin.value, coin.tokenType, Address(recipient))
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
      initialState: LocalState,
  ): Resource[IO, AllocatedWallet[IO, Wallet]] =
    Resource.make(
      Wallet
        .build[IO](
          Config(
            indexerRPCUri,
            indexerWSUri,
            proverServerUri,
            substrateNodeUri,
            LogLevel.Warn,
            core.Wallet.Snapshot(initialState, Seq.empty, None),
          ),
        )
        .flatTap(_.dependencies.walletSyncService.updates.compile.drain.start),
    )(_.finalizer)

  def withRunningWallet(initialWalletState: LocalState)(
      body: AllocatedWallet[IO, Wallet] => IO[Unit],
  ): IO[Unit] =
    makeRunningWalletResource(initialWalletState)
      .use(body(_))

  def makeWalletResource(
      initialState: LocalState,
  ): Resource[IO, AllocatedWallet[IO, Wallet]] = {
    Resource.make(
      Wallet
        .build[IO](
          Config(
            indexerRPCUri,
            indexerWSUri,
            proverServerUri,
            substrateNodeUri,
            LogLevel.Warn,
            core.Wallet.Snapshot(initialState, Seq.empty, None),
          ),
        ),
    )(_.finalizer)
  }

  def withWallet(initialWalletState: LocalState)(
      body: AllocatedWallet[IO, Wallet] => IO[Unit],
  ): IO[Unit] =
    makeWalletResource(initialWalletState)
      .use(body(_))
}

class EndToEndSpec extends CatsEffectSuite with EndToEndSpecSetup {

  override val munitIOTimeout: Duration = 60.seconds

  test("Submit transfer tx spending wallet balance".ignore) {
    val initialState = prepareStateWithCoins(List(coin))

    withRunningWallet(initialState) {
      case AllocatedWallet(
            WalletDependencies(_, walletState, txSubmission, walletTransactionService),
            _,
          ) =>
        for {
          balanceBeforeSend <- walletState.state
            .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
            .find(_ >= coin.value)
            .compile
            .lastOrError
          transferRecipe <- walletTransactionService.prepareTransferRecipe(
            prepareOutputs(List(spendCoin), randomRecipient()),
          )
          spendTx <- walletTransactionService.proveTransaction(transferRecipe)
          txId <- txSubmission.submitTransaction(spendTx)
          balanceAfterSend <- walletState.state
            .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
            .find(_ < coin.value)
            .compile
            .lastOrError
        } yield {
          // TODO: add better assertions, when wallet state API be ready
          assertEquals(txId.txId, spendTx.identifiers(0))
          assertEquals(balanceBeforeSend, coin.value)
          assert(balanceAfterSend < coin.value - spendCoin.value) // spend amount + fee
        }
    }
  }

  test(
    "Submit tx one after another with waiting for blocks apply and doesn't spend the same coin (no double spend)".ignore,
  ) {
    val initialState = prepareStateWithCoins(List(coin))

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
          appliedUpdatesQueue <- Queue.unbounded[IO, ViewingUpdate]
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
    val initialState = prepareStateWithCoins(List(coin))

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
