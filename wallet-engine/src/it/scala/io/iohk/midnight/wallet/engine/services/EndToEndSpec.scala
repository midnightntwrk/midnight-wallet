package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import munit.CatsEffectSuite
import scala.scalajs.js
import sttp.client3.UriContext
import typings.midnightLedger.mod.*
import typings.midnightMockedNodeApi.anon.Hash
import typings.midnightMockedNodeApi.transactionMod
import typings.midnightMockedNodeApp.anon.PartialConfigany
import typings.midnightMockedNodeApp.configMod.GenesisValue
import typings.midnightMockedNodeApp.mod.InMemoryServer

class EndToEndSpec extends CatsEffectSuite {
  private val tokenType = nativeToken()
  private val coin = new CoinInfo(js.BigInt(1_000_000), tokenType)
  private val spendCoin = new CoinInfo(js.BigInt(10_000), tokenType)
  private val changeCoin = new CoinInfo(js.BigInt(800_000), tokenType)
  private val initialState = new ZSwapLocalState().watchFor(coin).watchFor(changeCoin)
  private val pubKey = initialState.coinPublicKey
  private val ledgerState = new LedgerState()

  private val mintTx = {
    val output = ZSwapOutputWithRandomness.`new`(coin, pubKey)
    val deltas = new ZSwapDeltas()
    deltas.insert(tokenType, -coin.value)
    val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)

    new TransactionBuilder(ledgerState)
      .addOffer(offer, output.randomness)
      .merge[TransactionBuilder]
      .intoTransaction()
      .transaction
  }

  private def spendTx(state: ZSwapLocalState): Transaction = {
    val input = state.spend(coin)
    val spendOutput =
      ZSwapOutputWithRandomness.`new`(spendCoin, new ZSwapLocalState().coinPublicKey)
    val changeOutput = ZSwapOutputWithRandomness.`new`(changeCoin, pubKey)
    val deltas = new ZSwapDeltas()
    deltas.insert(tokenType, coin.value - spendCoin.value - changeCoin.value)
    val offer =
      new ZSwapOffer(
        js.Array(input.input),
        js.Array(spendOutput.output, changeOutput.output),
        js.Array(),
        deltas,
      )
    new TransactionBuilder(ledgerState)
      .addOffer(
        offer,
        input.randomness.merge(spendOutput.randomness).merge(changeOutput.randomness),
      )
      .merge[TransactionBuilder]
      .intoTransaction()
      .transaction
  }

  test("Wallet balance") {
    val ledgerTx = LedgerSerialization.toTransaction(mintTx)
    val tx = transactionMod.Transaction(ledgerTx.body, Hash(ledgerTx.header.hash.value))
    val nodeConfig =
      PartialConfigany()
        .setGenesis(GenesisValue("value", js.Array(tx)))
        .setHost("localhost")
        .setPort(5205)
    val node = new InMemoryServer(nodeConfig)
    node.run()

    Wallet
      .build[IO](Config(uri"ws://localhost:5205", initialState, LogLevel.Debug))
      .use { case (walletState, _, txSubmission) =>
        for {
          initialBalance <- walletState.balance().head.compile.lastOrError
          fiber <- walletState.start().start
          balanceBefore <- walletState.balance().head.compile.lastOrError
          state <- walletState.localState()
          transaction = spendTx(state)
          _ <- walletState.updateLocalState(state)
          _ <- txSubmission.submitTransaction(transaction)
          balanceAfter <- walletState.balance().head.compile.lastOrError
          _ <- IO(node.close())
          _ <- fiber.cancel
        } yield assertEquals(
          List(initialBalance, balanceBefore, balanceAfter),
          List(js.BigInt(0), coin.value, changeCoin.value),
        )
      }
  }
}
