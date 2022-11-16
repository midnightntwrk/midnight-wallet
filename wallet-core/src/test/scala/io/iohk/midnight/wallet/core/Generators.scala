package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.blockchain.data.Generators.{hashGen, heightGen, instantGen}
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*
import scala.scalajs.js
import typings.midnightLedger.mod.{Transaction as LedgerTransaction, *}

object Generators {
  private val tokenType: TokenType = nativeToken()

  val coinInfoGen: Gen[CoinInfo] =
    Gen.posNum[Int].map(js.BigInt(_)).map(new CoinInfo(_, tokenType))

  val ledgerTransactionGen: Gen[(LedgerTransaction, ZSwapLocalState)] =
    Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, coinInfoGen)).map(buildTransaction(_))

  def buildTransaction(
      coins: List[CoinInfo],
      state: ZSwapLocalState = new ZSwapLocalState(),
  ): (LedgerTransaction, ZSwapLocalState) = {
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

  val transactionGen: Gen[Transaction] =
    ledgerTransactionGen.map(_._1).map(LedgerSerialization.toTransaction)

  private val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block], hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  def blockGen(txs: Seq[Transaction]): Gen[Block] =
    blockHeaderGen.map(Block(_, Block.Body(txs)))
}
