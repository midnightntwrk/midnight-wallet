package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import munit.CatsEffectSuite
import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import sttp.client3.UriContext
import typings.midnightLedger.mod.*
import typings.midnightMockedNodeApi.anon.Hash
import typings.midnightMockedNodeApi.transactionMod.Transaction as ApiTransaction
import typings.midnightMockedNodeApp.anon.PartialConfigany
import typings.midnightMockedNodeApp.configMod.GenesisValue
import typings.midnightMockedNodeApp.mod.InMemoryServer

trait EndToEndSpecSetup {
  val nodeHost = "localhost"
  val nodePort = 5205L
  val tokenType = nativeToken()
  val coin = new CoinInfo(js.BigInt(1_000_000), tokenType)
  val spendCoin = new CoinInfo(js.BigInt(10_000), tokenType)
  val initialState = new ZSwapLocalState().watchFor(coin)
  val pubKey = initialState.coinPublicKey
  val recipientKey = new ZSwapLocalState().coinPublicKey
  val ledgerState = new LedgerState()

  def buildSendTx(coin: CoinInfo, recipient: ZSwapCoinPublicKey): Transaction = {
    val output = ZSwapOutputWithRandomness.`new`(coin, recipient)
    val deltas = new ZSwapDeltas()
    deltas.insert(tokenType, -coin.value)
    val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)
    new TransactionBuilder(ledgerState)
      .addOffer(offer, output.randomness)
      .merge[TransactionBuilder]
      .intoTransaction()
      .transaction
  }

  def buildNode(initialTxs: Transaction*): InMemoryServer = {
    val ledgerTxs = initialTxs.map(LedgerSerialization.toTransaction)
    val txs: Seq[Any] = ledgerTxs.map { ledgerTx =>
      ApiTransaction(ledgerTx.body, Hash(ledgerTx.header.hash.value))
    }
    val nodeConfig =
      PartialConfigany()
        .setGenesis(GenesisValue("value", txs.toJSArray))
        .setHost(nodeHost)
        .setPort(nodePort.toDouble)
    new InMemoryServer(nodeConfig)
  }
}

class EndToEndSpec extends CatsEffectSuite with EndToEndSpecSetup {
  test("Submit tx spending wallet balance") {
    val mintTx = buildSendTx(coin, pubKey)
    val spendTx = buildSendTx(spendCoin, recipientKey)
    val fee = js.BigInt(1787) // This value was extracted after first run since it's not predictable
    val node = buildNode(mintTx)
    node.run()

    Wallet
      .build[IO](Config(uri"ws://$nodeHost:$nodePort", initialState, LogLevel.Warn))
      .use { case (walletState, _, txSubmission) =>
        for {
          initialBalance <- walletState.balance().head.compile.lastOrError
          fiber <- walletState.start().start
          balanceBeforeSend <- walletState.balance().head.compile.lastOrError
          _ <- txSubmission.submitTransaction(spendTx)
          balanceAfterSend <- walletState.balance().head.compile.lastOrError
          _ <- fiber.cancel
          _ <- IO(node.close())
        } yield {
          assertEquals(
            List(initialBalance, balanceBeforeSend, balanceAfterSend),
            List(js.BigInt(0), coin.value, coin.value - spendCoin.value - fee),
          )
        }
      }
  }

  test("Filter transactions") {
    val mintTx = buildSendTx(coin, pubKey)
    val spendTx = buildSendTx(spendCoin, recipientKey)
    val expectedIdentifier = spendTx.identifiers().head
    val node = buildNode(mintTx)
    node.run()

    Wallet
      .build[IO](Config(uri"ws://$nodeHost:$nodePort", initialState, LogLevel.Warn))
      .use { case (walletState, filterService, txSubmission) =>
        for {
          fiber <- walletState.start().start
          _ <- walletState.balance().head.compile.lastOrError
          _ <- txSubmission.submitTransaction(spendTx)
          filteredTx <- filterService
            .installTransactionFilter(_.hasIdentifier(expectedIdentifier))
            .head
            .compile
            .lastOrError
          _ <- fiber.cancel
          _ <- IO(node.close())
        } yield {
          assert(filteredTx.identifiers().exists(_.equals(expectedIdentifier)))
        }
      }
  }
}
