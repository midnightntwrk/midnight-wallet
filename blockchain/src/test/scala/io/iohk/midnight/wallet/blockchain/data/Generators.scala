package io.iohk.midnight.wallet.blockchain.data

import cats.syntax.all.*
import io.circe.Json
import java.time.Instant
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  def hashGen[T]: Gen[Hash[T]] = Gen.hexStr.map(Hash[T].apply)

  val jsonFieldGen: Gen[(String, Json)] = for {
    name <- Gen.alphaStr
    value <- Gen.alphaNumStr
  } yield (name, Json.fromString(value))

  val jsonGen: Gen[ArbitraryJson] = for {
    fields <- Gen.nonEmptyListOf(jsonFieldGen)
  } yield ArbitraryJson(Json.obj(fields*))

  val heightGen: Gen[Block.Height] =
    Gen.posNum[BigInt].map(Block.Height.apply).collect { case Right(n) => n }

  val instantGen: Gen[Instant] = Gen.long.map(Instant.ofEpochMilli)

  val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block], hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  val transactionHeaderGen: Gen[Transaction.Header] =
    hashGen[Transaction].map(Transaction.Header.apply)

  val transactionGen: Gen[Transaction] =
    (transactionHeaderGen, jsonGen).mapN(Transaction.apply)

  val blockBodyGen: Gen[Block.Body] = Gen.listOf(transactionGen).map(Block.Body.apply)

  val blockGen: Gen[Block] =
    (blockHeaderGen, blockBodyGen).mapN(Block.apply)
}
