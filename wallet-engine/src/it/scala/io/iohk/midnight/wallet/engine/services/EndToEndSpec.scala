package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import io.iohk.midnight.wallet.engine.WalletBuilder as Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import munit.CatsEffectSuite
import scala.scalajs.js
import sttp.client3.UriContext
import typings.midnightLedger.mod.*
import typings.midnightMockedNodeInMemoryServer.anon.PartialConfig
import typings.midnightMockedNodeInMemoryServer.mod.InMemoryServer

class EndToEndSpec extends CatsEffectSuite {
  private val coin = new CoinInfo(js.BigInt(1000), FieldElement.fromBigint(js.BigInt(0)))
  private val tokenType = FieldElement.fromBigint(js.BigInt(0))
  private val state = new ZSwapLocalState().watchFor(coin)

  private val output = ZSwapOutputWithRandomness.`new`(coin, state.coinPublicKey)

  private val deltas = new ZSwapDeltas()
  deltas.insert(tokenType, -coin.value)

  private val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)

  private val tx =
    new TransactionBuilder(new LedgerState())
      .addOffer(offer, output.randomness)
      .merge[TransactionBuilder]
      .intoTransaction()
      .transaction

  test("Wallet balance") {
    val node = new InMemoryServer(PartialConfig().setHost("localhost").setPort(5205))
    node.run()

    Wallet
      .build[IO](Config(uri"ws://localhost:5205", state))
      .use { case (walletState, _, txSubmission) =>
        for {
          fiber <- walletState.start().start
          _ <- txSubmission.submitTransaction(tx)
          balance <- walletState.balance().dropWhile(_ <= js.BigInt(0)).head.compile.lastOrError
          _ <- IO(node.close())
          _ <- fiber.cancel
        } yield assertEquals(balance, coin.value)
      }
  }
}
