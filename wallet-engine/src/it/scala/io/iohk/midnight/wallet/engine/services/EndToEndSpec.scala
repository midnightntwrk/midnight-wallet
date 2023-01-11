package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.syntax.flatMap.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightMockedNodeApi.anon.Hash
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as ApiTransaction
import io.iohk.midnight.midnightMockedNodeApp.anon.PartialConfigany
import io.iohk.midnight.midnightMockedNodeApp.distConfigMod.GenesisValue
import io.iohk.midnight.midnightMockedNodeApp.mod.InMemoryServer
import io.iohk.midnight.rxjs.mod.find
import io.iohk.midnight.rxjs.mod.firstValueFrom
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.ConsoleTracer
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import io.iohk.midnight.wallet.engine.js.JsWallet
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import munit.CatsEffectSuite
import sttp.client3.UriContext

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*

trait EndToEndSpecSetup {
  val nodeHost = "localhost"
  val nodePort = 5205L
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

  def makeNodeResource(initialTxs: Transaction*): Resource[IO, Unit] = {
    val txs: Seq[Any] =
      initialTxs
        .map(LedgerSerialization.toTransaction)
        .map(tx => ApiTransaction(tx.body, Hash(tx.header.hash.value)))

    val nodeConfig =
      PartialConfigany()
        .setGenesis(GenesisValue("value", txs.toJSArray))
        .setHost(nodeHost)
        .setPort(nodePort.toDouble)

    Resource
      .make(IO(new InMemoryServer(nodeConfig)))(node => IO.fromPromise(IO(node.close())))
      .evalMap(node => IO.fromPromise(IO(node.run())))
  }

  type Wallets = (WalletState[IO], WalletFilterService[IO], WalletTxSubmission[IO])

  def makeWalletResource(initialState: ZSwapLocalState): Resource[IO, Wallets] = {
    implicit val rootTracer: Tracer[IO, StructuredLog] =
      ConsoleTracer.contextAware(LogLevel.Info)
    Wallet
      .build[IO](Config(uri"ws://$nodeHost:$nodePort", initialState, LogLevel.Warn))
      .flatTap(_._1.start.background)
  }

  def withWallet(initialWalletState: ZSwapLocalState, initialTxs: Transaction*)(
      body: Wallets => IO[Unit],
  ): IO[Unit] =
    makeNodeResource(initialTxs*)
      .flatMap(_ => makeWalletResource(initialWalletState))
      .use(body(_))
}

class EndToEndSpec extends CatsEffectSuite with EndToEndSpecSetup {
  test("Submit tx spending wallet balance") {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)
    val spendTx = buildSendTx(spendCoin, randomRecipient())
    val fee = js.BigInt(1787) // This value was extracted after first run since it's not predictable

    withWallet(initialState, mintTx) { case (walletState, _, txSubmission) =>
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

  test("Get initial balance from rxjs Observable") {
    val initialState = new ZSwapLocalState()
    initialState.watchFor(coin)
    val pubKey = initialState.coinPublicKey
    val mintTx = buildSendTx(coin, pubKey)

    withWallet(initialState, mintTx) { case (walletState, walletFilter, walletTxSubmission) =>
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

    withWallet(initialState, mintTx) { case (walletState, filterService, txSubmission) =>
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
