package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.syntax.eq.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightMockedNodeApi.anon.Hash
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as ApiTransaction
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import io.iohk.midnight.midnightMockedNodeInMemory.distGenesisMod.GenesisValue
import io.iohk.midnight.midnightMockedNodeInMemory.mod.{InMemoryMockedNode, LedgerNapi}
import io.iohk.midnight.rxjs.mod.{find, firstValueFrom}
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.{AllocatedWallet, WalletDependencies}
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.engine.config.NodeConnection.NodeInstance
import io.iohk.midnight.wallet.engine.js.JsWallet
import munit.CatsEffectSuite
import scala.scalajs.js
import scala.scalajs.js.JSConverters.*

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

  def makeNodeResource(initialTxs: Transaction*): Resource[IO, MockedNode[ApiTransaction]] = {
    val txs =
      initialTxs
        .map(LedgerSerialization.toTransaction)
        .map(tx => ApiTransaction(tx.body, Hash(tx.header.hash.value)))
    Resource.pure(
      new InMemoryMockedNode(GenesisValue("value", txs.toJSArray), new LedgerNapi()),
    )
  }

  type Wallets = (WalletState[IO], WalletFilterService[IO], WalletTxSubmission[IO])

  def makeWalletResource(
      node: MockedNode[ApiTransaction],
      initialState: ZSwapLocalState,
  ): Resource[IO, AllocatedWallet[IO]] = {
    Resource.make(
      Wallet
        .build[IO](Config(NodeInstance(node), initialState, LogLevel.Warn))
        .flatTap(_.dependencies.state.start.start),
    )(_.finalizer)
  }

  def withWallet(initialWalletState: ZSwapLocalState, initialTxs: Transaction*)(
      body: AllocatedWallet[IO] => IO[Unit],
  ): IO[Unit] =
    makeNodeResource(initialTxs*)
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

    withWallet(initialState, mintTx) {
      case AllocatedWallet(WalletDependencies(walletState, _, txSubmission), _) =>
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

    withWallet(initialState, mintTx) {
      case AllocatedWallet(WalletDependencies(walletState, walletFilter, walletTxSubmission), _) =>
        val jsWallet = new JsWallet(walletState, walletFilter, walletTxSubmission, IO.unit)
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

    withWallet(initialState, mintTx) {
      case AllocatedWallet(WalletDependencies(walletState, filterService, txSubmission), _) =>
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
