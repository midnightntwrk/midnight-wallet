package io.iohk.midnight.wallet.blockchain.data

import cats.syntax.all.*
import io.circe.Json
import java.time.Instant
import org.scalacheck.Arbitrary.arbitrary
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  def hashGen[T]: Gen[Hash[T]] = Gen.hexStr.map(Hash[T].apply)

  val circuitValuesGen: Gen[CircuitValues] =
    (arbitrary[Int], arbitrary[Int], arbitrary[Int]).mapN(CircuitValues.apply)

  val addressGen: Gen[Address] = Gen.hexStr.map(Address.apply)

  val functionNameGen: Gen[FunctionName] = Gen.alphaStr.map(FunctionName.apply)

  val jsonFieldGen: Gen[(String, Json)] = for {
    name <- Gen.alphaStr
    value <- Gen.alphaNumStr
  } yield (name, Json.fromString(value))

  val jsonGen: Gen[ArbitraryJson] = for {
    fields <- Gen.nonEmptyListOf(jsonFieldGen)
  } yield ArbitraryJson(Json.obj(fields*))

  val nonceGen: Gen[Nonce] = Gen.hexStr.map(Nonce.apply)

  val queryGen: Gen[Query] =
    (
      functionNameGen,
      jsonGen,
      jsonGen,
    ).mapN(Query.apply)

  val transcriptGen: Gen[Transcript] = Gen.nonEmptyListOf(queryGen).map(Transcript.apply)

  val transitionFunctionCircuitsGen: Gen[TransitionFunctionCircuits] =
    Gen
      .nonEmptyListOf(Gen.alphaNumStr)
      .map(TransitionFunctionCircuits.apply)

  val oracleGen: Gen[Oracle] = transcriptGen.map(Oracle.apply)

  val contractGen: Gen[Contract] =
    (Gen.option(oracleGen), Gen.option(oracleGen)).mapN(Contract.apply)

  val proofGen: Gen[Proof] = Gen.alphaNumStr.map(Proof.apply)

  val proofIdGen: Gen[ProofId] = Gen.alphaNumStr.map(ProofId.apply)

  val heightGen: Gen[Block.Height] =
    Gen.posNum[BigInt].map(Block.Height.apply).collect { case Right(n) => n }

  val instantGen: Gen[Instant] = Gen.long.map(Instant.ofEpochMilli)

  val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block], hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  val deployTransactionGen: Gen[DeployTransaction] =
    (
      hashGen[DeployTransaction],
      instantGen,
      contractGen,
      transitionFunctionCircuitsGen,
    )
      .mapN(DeployTransaction.apply)

  val callTransactionGen: Gen[CallTransaction] =
    (
      hashGen[CallTransaction],
      instantGen,
      addressGen,
      functionNameGen,
      proofGen,
      nonceGen,
      transcriptGen,
    )
      .mapN(CallTransaction.apply)

  val transactionGen: Gen[Transaction] =
    Gen.oneOf(deployTransactionGen, callTransactionGen)

  val blockBodyGen: Gen[Block.Body] = Gen.listOf(transactionGen).map(Block.Body.apply)

  val blockGen: Gen[Block] =
    (blockHeaderGen, blockBodyGen).mapN(Block.apply)
}
