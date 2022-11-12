package io.iohk.midnight.wallet.blockchain.data

import cats.syntax.all.*
import io.circe.Json
import java.time.Instant
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  private val hexStringGen: Gen[String] =
    Gen
      .chooseNum(1, 200) // Reasonable size
      .map(_ * 2) // Has to be an even number
      .flatMap(Gen.buildableOfN[String, Char](_, Gen.hexChar))

  def hashGen[T]: Gen[Hash[T]] =
    hexStringGen.map(Hash[T].apply)

  val heightGen: Gen[Block.Height] =
    Gen.posNum[BigInt].map(Block.Height.apply).collect { case Right(n) => n }

  val instantGen: Gen[Instant] =
    Gen.long.map(Instant.ofEpochMilli)

  private val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block], hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  private val transactionHeaderGen: Gen[Transaction.Header] =
    hashGen[Transaction].map(Transaction.Header.apply)

  private val transactionBodyGen: Gen[ArbitraryJson] =
    hexStringGen.map(Json.fromString).map(ArbitraryJson.apply)

  private val transactionGen: Gen[Transaction] =
    (transactionHeaderGen, transactionBodyGen).mapN(Transaction.apply)

  private val blockBodyGen: Gen[Block.Body] =
    Gen.listOf(transactionGen).map(Block.Body.apply)

  /** These blocks cointain transactions that are not real but only a random hex string wrapped in
    * Json
    */
  val blockGen: Gen[Block] =
    (blockHeaderGen, blockBodyGen).mapN(Block.apply)
}
