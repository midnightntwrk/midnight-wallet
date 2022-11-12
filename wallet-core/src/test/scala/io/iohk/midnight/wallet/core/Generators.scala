package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.circe.Json
import io.iohk.midnight.wallet.blockchain.data.Generators.{hashGen, heightGen, instantGen}
import io.iohk.midnight.wallet.blockchain.data.*
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*
import scala.scalajs.js
import typings.midnightLedger.mod.{Transaction as LedgerTransaction, *}
import typings.node.bufferMod.global.BufferEncoding

object Generators {
  private val tokenType: FieldElement = FieldElement.fromBigint(js.BigInt(0))

  val coinInfoGen: Gen[CoinInfo] =
    Gen.posNum[Int].map(js.BigInt(_)).map(new CoinInfo(_, tokenType))

  val ledgerTransactionGen: Gen[(LedgerTransaction, ZSwapLocalState)] =
    Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, coinInfoGen)).map(buildTransaction)

  def buildTransaction(coins: List[CoinInfo]): (LedgerTransaction, ZSwapLocalState) = {
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

  val transactionGen: Gen[Transaction] =
    ledgerTransactionGen
      .map(_._1)
      .map { tx =>
        val header = tx.transactionHash().serialize().toString(BufferEncoding.hex)
        val body = ArbitraryJson.apply(Json.fromString(tx.serialize().toString(BufferEncoding.hex)))
        Transaction(Transaction.Header(Hash[Transaction](header)), body)
      }

  private val blockBodyGen: Gen[Block.Body] =
    Gen
      .chooseNum(1, 5) // Number must be constrained because it takes time to build the txs
      .flatMap(Gen.listOfN(_, transactionGen))
      .map(Block.Body.apply)

  private val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block], hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  val blockGen: Gen[Block] =
    (blockHeaderGen, blockBodyGen).mapN(Block.apply)
}
