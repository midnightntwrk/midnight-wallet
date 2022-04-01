package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import io.circe.Json
import io.iohk.midnight.wallet.Wallet.*
import java.time.Instant
import org.scalacheck.Arbitrary.arbitrary
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  def hashGen[T]: Gen[Hash[T]] = Gen.hexStr.map(Hash[T].apply)

  val publicTranscriptGen: Gen[PublicTranscript] =
    Gen.alphaNumStr.map(Json.fromString).map(PublicTranscript.apply)

  val transitionFunctionGen: Gen[TransitionFunction] = Gen.alphaNumStr.map(TransitionFunction.apply)

  val contractSourceGen: Gen[ContractSource] = Gen.alphaNumStr.map(ContractSource.apply)

  val publicStateGen: Gen[PublicState] = Gen.alphaNumStr.map(Json.fromString).map(PublicState.apply)

  val circuitValuesGen: Gen[CircuitValues] =
    (arbitrary[Int], arbitrary[Int], arbitrary[Int]).mapN(CircuitValues.apply)

  val nonceGen: Gen[Nonce] = Gen.hexStr.map(Nonce.apply)

  val callContractInputGen: Gen[CallContractInput] =
    (
      hashGen[DeployTransaction],
      nonceGen,
      publicTranscriptGen,
      transitionFunctionGen,
      circuitValuesGen,
    )
      .mapN(CallContractInput.apply)

  val deployContractInputGen: Gen[DeployContractInput] =
    (contractSourceGen, publicStateGen).mapN(DeployContractInput.apply)

  val transitionFunctionCircuitsGen: Gen[TransitionFunctionCircuits] =
    Gen
      .nonEmptyMap((Gen.alphaNumStr, Gen.alphaNumStr).tupled)
      .map(TransitionFunctionCircuits.apply)

  val proofGen: Gen[Proof] = Gen.alphaNumStr.map(Proof.apply)

  val proofIdGen: Gen[ProofId] = Gen.alphaNumStr.map(ProofId.apply)

  val heightGen: Gen[Block.Height] =
    Gen.posNum[BigInt].map(Block.Height.apply).collect { case Right(n) => n }

  val instantGen: Gen[Instant] = Gen.long.map(Instant.ofEpochMilli)

  val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block].map(Option(_)), hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  val deployTransactionGen: Gen[DeployTransaction] =
    (
      hashGen[DeployTransaction].map(Option(_)),
      instantGen,
      contractSourceGen,
      publicStateGen,
      transitionFunctionCircuitsGen,
    )
      .mapN(DeployTransaction.apply)

  val callTransactionGen: Gen[CallTransaction] =
    (
      hashGen[CallTransaction].map(Option(_)),
      nonceGen,
      instantGen,
      hashGen[DeployTransaction],
      transitionFunctionGen,
      proofGen.map(Option(_)),
      publicTranscriptGen,
    )
      .mapN(CallTransaction.apply)

  val transactionGen: Gen[Transaction] =
    Gen.oneOf(deployTransactionGen, callTransactionGen)

  val successReceiptGen: Gen[Receipt.Success.type] = Gen.const(Receipt.Success)

  val contractFailureReceiptGen: Gen[Receipt.ContractFailure] =
    (Gen.choose(Int.MinValue, Int.MaxValue), Gen.alphaNumStr).mapN(Receipt.ContractFailure.apply)

  val zkFailureReceiptGen: Gen[Receipt.ZKFailure] = Gen.alphaNumStr.map(Receipt.ZKFailure.apply)

  val ledgerFailureReceiptGen: Gen[Receipt.LedgerFailure] =
    Gen.alphaNumStr.map(Receipt.LedgerFailure.apply)

  val receiptGen: Gen[Receipt] =
    Gen.oneOf(
      successReceiptGen,
      contractFailureReceiptGen,
      zkFailureReceiptGen,
      ledgerFailureReceiptGen,
    )

  val txWithReceiptGen: Gen[TransactionWithReceipt] =
    (transactionGen, receiptGen).mapN(TransactionWithReceipt.apply)

  val blockGen: Gen[Block] =
    (blockHeaderGen, Gen.containerOf[Seq, TransactionWithReceipt](txWithReceiptGen))
      .mapN(Block.apply)

  val witnessGen: Gen[Witness] = Gen.alphaNumStr.map(Json.fromString).map(Witness.apply)

  val txRequestGen: Gen[TransactionRequest] =
    (hashGen[DeployTransaction], publicTranscriptGen, witnessGen, transitionFunctionGen, nonceGen)
      .mapN(TransactionRequest.apply)
}
