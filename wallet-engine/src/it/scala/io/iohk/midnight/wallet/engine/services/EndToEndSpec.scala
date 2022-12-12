package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.syntax.flatMap.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import munit.CatsEffectSuite
import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import sttp.client3.UriContext
import typings.midnightLedger.mod.*
import typings.midnightMockedNodeApi.anon.Hash
import typings.midnightMockedNodeApi.distDataTransactionMod.Transaction as ApiTransaction
import typings.midnightMockedNodeApp.anon.PartialConfigany
import typings.midnightMockedNodeApp.distConfigMod.GenesisValue
import typings.midnightMockedNodeApp.mod.InMemoryServer

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

  def makeWalletResource(initialState: ZSwapLocalState): Resource[IO, Wallets] =
    Wallet
      .build[IO](Config(uri"ws://$nodeHost:$nodePort", initialState, LogLevel.Warn))
      .flatTap(_._1.start.background)

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
        balanceBeforeSend <- walletState.balance
          .takeWhile(_ < coin.value, takeFailure = true)
          .compile
          .toList
        _ <- txSubmission.submitTransaction(spendTx, List.empty)
        balanceAfterSend <- walletState.balance.head.compile.lastOrError
      } yield {
        assertEquals(
          balanceBeforeSend ++ List(balanceAfterSend),
          List(js.BigInt(0), coin.value, coin.value - spendCoin.value - fee),
        )
      }
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
