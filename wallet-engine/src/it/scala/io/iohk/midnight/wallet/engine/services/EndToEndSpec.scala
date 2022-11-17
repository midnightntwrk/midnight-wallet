package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import munit.CatsEffectSuite
import sttp.client3.UriContext
import typings.midnightLedger.mod.*
import typings.midnightMockedNodeInMemoryServer.anon.PartialConfig
import typings.midnightMockedNodeInMemoryServer.mod.InMemoryServer

import scala.scalajs.js

class EndToEndSpec extends CatsEffectSuite {
  private val tokenType = nativeToken()
  private def generateTransaction(
      amount: js.BigInt,
      startingState: ZSwapLocalState = new ZSwapLocalState(),
  ): (Transaction, ZSwapLocalState) = {
    val coin = new CoinInfo(amount, tokenType)

    val state = startingState.watchFor(coin)

    val output = ZSwapOutputWithRandomness.`new`(coin, state.coinPublicKey)

    val deltas = new ZSwapDeltas()
    deltas.insert(tokenType, -coin.value)

    val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)

    val tx =
      new TransactionBuilder(new LedgerState())
        .addOffer(offer, output.randomness)
        .merge[TransactionBuilder]
        .intoTransaction()
        .transaction
    (tx, state)
  }

  private val (mintTx, state) = generateTransaction(js.BigInt(10000))
  private val stateWithCoins = state.applyLocal(mintTx)
  private val (tx, watchingState) = generateTransaction(js.BigInt(1000), stateWithCoins)
  private val balanceBeforeSpending = watchingState.coins.map(_.value).combineAll(sum)

  test("Wallet balance") {
    val node = new InMemoryServer(PartialConfig().setHost("localhost").setPort(5205))
    node.run()

    Wallet
      .build[IO](Config(uri"ws://localhost:5205", watchingState, LogLevel.Trace))
      .use { case (walletState, _, txSubmission) =>
        for {
          fiber <- walletState.start().start
          _ <- txSubmission.submitTransaction(tx)
          balance <- walletState.balance().dropWhile(_ <= js.BigInt(0)).head.compile.lastOrError
          _ <- IO(node.close())
          _ <- fiber.cancel
        } yield assert(balance < balanceBeforeSpending)
      }
  }
}
