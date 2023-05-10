package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.effect.std.Queue
import cats.effect.unsafe.implicits.global
import cats.syntax.eq.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightMockedNodeApi.anon.Hash
import io.iohk.midnight.midnightMockedNodeApi.distDataBlockMod.Block
import io.iohk.midnight.midnightMockedNodeApi.distDataRequestNextResultMod.RequestNextResult
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as ApiTransaction
import io.iohk.midnight.midnightMockedNodeApi.distDataTxSubmissionResultMod
import io.iohk.midnight.midnightMockedNodeTest.distTestSystemMod.TestSystem
import io.iohk.midnight.midnightMockedNodeTest.mod.ProdTestSystem
import io.iohk.midnight.rxjs.mod.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.BlockProcessingFactory.AppliedBlock
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.{AllocatedWallet, WalletDependencies}
import io.iohk.midnight.wallet.engine.config.{Config, NodeConnectionResourced}
import io.iohk.midnight.wallet.engine.js.{JsWallet, NodeConnection, SubmitSession, SyncSession}
import munit.CatsEffectSuite

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.Promise

trait EndToEndSpecSetup {
  val nodeHost = "localhost"
  val nodePort = 5206L
  val tokenType = nativeToken()
  val coin = new CoinInfo(js.BigInt(1_000_000), tokenType)
  val spendCoin = new CoinInfo(js.BigInt(10_000), tokenType)
  def randomRecipient(): ZSwapCoinPublicKey = new ZSwapLocalState().coinPublicKey

  def buildSendTx(coin: CoinInfo, recipient: ZSwapCoinPublicKey): Transaction = {
    val output = ZSwapOutputWithRandomness.`new`(coin, recipient)
    val deltas = new ZSwapDeltas()
    deltas.insert(tokenType, -coin.value)
    val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)
    val builder = new TransactionBuilder(new LedgerState())
    builder.addOffer(offer, output.randomness)
    builder.intoTransaction().transaction
  }

  def makeTestSystemResource(initialTxs: Transaction*): Resource[IO, TestSystem[ApiTransaction]] = {
    val txs =
      initialTxs
        .map(LedgerSerialization.toTransaction)
        .map(tx => ApiTransaction(tx.body, Hash(tx.header.hash.value)))
    Resource.pure(ProdTestSystem(txs.toJSArray))
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def makeNodeConnection(testSystem: TestSystem[ApiTransaction]): NodeConnectionResourced = {
    val nodeConnection = new NodeConnection {

      override def startSyncSession(): js.Promise[SyncSession] = IO {
        new SyncSession {
          private val session = testSystem.startClientSession("wallet-e2e-sync")

          override def sync(): Observable_[Block[ApiTransaction]] = {
            val filterFun = {
              (requestNextResult: RequestNextResult[Block[ApiTransaction]], _: Double) =>
                {
                  val tag = requestNextResult.asInstanceOf[js.Dynamic].tag.asInstanceOf[String]
                  tag === "RollForward"
                }
            }

            val mapFun = {
              (requestNextResult: RequestNextResult[Block[ApiTransaction]], _: Double) =>
                {
                  requestNextResult
                    .asInstanceOf[js.Dynamic]
                    .block
                    .asInstanceOf[Block[ApiTransaction]]
                }
            }

            session
              .sync()
              .pipe(filter(filterFun), map(mapFun))
              .asInstanceOf[Observable_[Block[ApiTransaction]]]
          }

          override def close(): Unit =
            session.close()
        }
      }.unsafeToPromise()

      override def startSubmitSession(): js.Promise[SubmitSession] = IO {
        new SubmitSession {
          private val session = testSystem.startClientSession("wallet-e2e-submit")

          override def submitTx(
              tx: ApiTransaction,
          ): Promise[distDataTxSubmissionResultMod.TxSubmissionResult] =
            session.submitTx(tx)

          override def close(): Unit =
            session.close()
        }
      }.unsafeToPromise()
    }
    NodeConnectionResourced(nodeConnection)
  }

  def makeRunningWalletResource(
      testSystem: TestSystem[ApiTransaction],
      initialState: ZSwapLocalState,
  ): Resource[IO, AllocatedWallet[IO, Wallet]] =
    Resource.make(
      Wallet
        .build[IO](Config(makeNodeConnection(testSystem), initialState, LogLevel.Warn))
        .flatTap(_.dependencies.walletBlockProcessingService.blocks.compile.drain.start),
    )(_.finalizer)

  def withRunningWallet(initialWalletState: ZSwapLocalState, initialTxs: Transaction*)(
      body: AllocatedWallet[IO, Wallet] => IO[Unit],
  ): IO[Unit] =
    makeTestSystemResource(initialTxs*)
      .flatMap(makeRunningWalletResource(_, initialWalletState))
      .use(body(_))

  def makeWalletResource(
      testSystem: TestSystem[ApiTransaction],
      initialState: ZSwapLocalState,
  ): Resource[IO, AllocatedWallet[IO, Wallet]] = {
    Resource.make(
      Wallet
        .build[IO](Config(makeNodeConnection(testSystem), initialState, LogLevel.Warn)),
    )(_.finalizer)
  }

  def withWallet(initialWalletState: ZSwapLocalState, initialTxs: Transaction*)(
      body: AllocatedWallet[IO, Wallet] => IO[Unit],
  ): IO[Unit] =
    makeTestSystemResource(initialTxs*)
      .flatMap(makeWalletResource(_, initialWalletState))
      .use(body(_))
}

class EndToEndSpec extends CatsEffectSuite with EndToEndSpecSetup {
  test("Submit tx spending wallet balance") {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)
    val spendTx = buildSendTx(spendCoin, randomRecipient())
    // These values were extracted after first run since it's not predictable
    val fee = if (isLedgerNoProofs) js.BigInt(2403) else js.BigInt(5585)

    withRunningWallet(initialState, mintTx) {
      case AllocatedWallet(WalletDependencies(_, walletState, _, txSubmission), _) =>
        for {
          balanceBeforeSend <- walletState.balance.find(_ >= coin.value).compile.lastOrError
          _ <- txSubmission.submitTransaction(spendTx, List.empty)
          balanceAfterSend <- walletState.balance.find(_ < coin.value).compile.lastOrError
        } yield {
          assertEquals(balanceBeforeSend, coin.value)
          assertEquals(balanceAfterSend, coin.value - spendCoin.value - fee)
        }
    }
  }

  test(
    "Submit tx one after another with waiting for blocks apply and doesn't spend the same coin (no double spend)",
  ) {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)
    val firstSpendTx = buildSendTx(spendCoin, randomRecipient())
    val secondSpendTx = buildSendTx(spendCoin, randomRecipient())
    // These values were extracted after first run since it's not predictable
    val fee = if (isLedgerNoProofs) js.BigInt(2403) else js.BigInt(5585)

    withWallet(initialState, mintTx) {
      case AllocatedWallet(
            WalletDependencies(walletBlockProcessingService, walletState, _, txSubmission),
            _,
          ) =>
        for {
          appliedBlocksQueue <- Queue.unbounded[IO, AppliedBlock]
          _ <- walletBlockProcessingService.blocks
            .collect { case Right(value) =>
              value
            }
            .enqueueUnterminated(appliedBlocksQueue)
            .compile
            .drain
            .start
          _ <- appliedBlocksQueue.take
          balanceBeforeSend <- walletState.balance.find(_ >= coin.value).compile.lastOrError
          _ <- txSubmission.submitTransaction(firstSpendTx, List.empty)
          _ <- appliedBlocksQueue.take
          balanceAfter1Send <- walletState.balance.find(_ < coin.value).compile.lastOrError
          _ <- txSubmission.submitTransaction(secondSpendTx, List.empty)
          _ <- appliedBlocksQueue.take
          balanceAfter2Send <- walletState.balance.find(_ < coin.value).compile.lastOrError
        } yield {
          assertEquals(balanceBeforeSend, coin.value)
          assertEquals(balanceAfter1Send, coin.value - spendCoin.value - fee)
          assertEquals(balanceAfter2Send, balanceAfter1Send - spendCoin.value - fee)
        }
    }
  }

  test("Submit tx one after another and doesn't spend the same coin (no double spend)") {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)
    val firstSpendTx = buildSendTx(spendCoin, randomRecipient())
    val secondSpendTx = buildSendTx(spendCoin, randomRecipient())

    val quickTxSend = withWallet(initialState, mintTx) {
      case AllocatedWallet(
            WalletDependencies(walletBlockProcessingService, _, _, txSubmission),
            _,
          ) =>
        for {
          _ <- walletBlockProcessingService.blocks.take(1).compile.toList
          firstTxResult <- txSubmission.submitTransaction(firstSpendTx, List.empty).attempt
          _ <-
            if (firstTxResult.isRight) txSubmission.submitTransaction(secondSpendTx, List.empty)
            else fail("Submitting first transaction has failed")
        } yield ()
    }

    interceptMessageIO[Throwable]("Not sufficient funds to balance the cost of transaction")(
      quickTxSend,
    )
  }

  private def isLedgerNoProofs: Boolean =
    readEnvVariable[String]("NO_PROOFS") === Some("true")

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def readEnvVariable[T](name: String): Option[T] =
    js.Dynamic.global.process.env.selectDynamic(name).asInstanceOf[js.UndefOr[T]].toOption

  test("Get initial balance from rxjs Observable") {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)

    withRunningWallet(initialState, mintTx) {
      case AllocatedWallet(
            WalletDependencies(
              walletBlockProcessingService,
              walletState,
              walletFilter,
              walletTxSubmission,
            ),
            _,
          ) =>
        val jsWallet = new JsWallet(
          walletBlockProcessingService,
          walletState,
          walletFilter,
          walletTxSubmission,
          IO.unit,
        )
        IO.fromPromise(IO {
          firstValueFrom(
            jsWallet.balance().pipe(find { (value, _, _) => value > js.BigInt(0) }),
          )
        }).map(_.toOption)
          .assertEquals(Some(coin.value))
    }
  }

  test("Filter transactions") {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)
    val spendTx = buildSendTx(spendCoin, randomRecipient())
    val expectedIdentifier = spendTx.identifiers().head

    withRunningWallet(initialState, mintTx) {
      case AllocatedWallet(WalletDependencies(_, walletState, filterService, txSubmission), _) =>
        for {
          _ <- walletState.balance.find(_ > js.BigInt(0)).compile.lastOrError
          _ <- txSubmission.submitTransaction(spendTx, List(spendCoin))
          filteredTx <- filterService
            .installTransactionFilter(_.hasIdentifier(expectedIdentifier))
            .head
            .compile
            .lastOrError
        } yield {
          assert(filteredTx.identifiers().exists(_.equals(expectedIdentifier)))
        }
    }
  }
}
