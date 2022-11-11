package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import org.scalacheck.Gen
import scala.scalajs.js
import typings.midnightLedger.mod.*

object Generators {
  val tokenType: FieldElement = FieldElement.fromBigint(js.BigInt(0))

  val coinInfoGen: Gen[CoinInfo] =
    Gen.posNum[Int].map(js.BigInt(_)).map(new CoinInfo(_, tokenType))

  val transactionGen: Gen[(Transaction, ZSwapLocalState)] =
    Gen.nonEmptyListOf(coinInfoGen).map(buildTransaction)

  def buildTransaction(coins: List[CoinInfo]): (Transaction, ZSwapLocalState) = {
    val state = new ZSwapLocalState()
    val builder = new TransactionBuilder(new LedgerState())
    coins
      .foldLeft((builder, state)) { case ((builder, state), coin) =>
        val output = ZSwapOutputWithRandomness.`new`(coin, state.coinPublicKey)
        val deltas = new ZSwapDeltas()
        deltas.insert(tokenType, -coin.value)
        val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)
        val newBuilder = builder
          .addOffer(offer, output.randomness)
          .merge[TransactionBuilder]
        val newState = state.watchFor(coin)
        (newBuilder, newState)
      }
      .leftMap(_.intoTransaction().transaction)
  }
}
