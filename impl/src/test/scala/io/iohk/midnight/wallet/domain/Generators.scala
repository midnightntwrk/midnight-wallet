package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import io.iohk.midnight.wallet.api.WalletAPI.*
import org.scalacheck.Arbitrary.arbitrary
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  val contractHashGen = Gen.hexStr.map(Hash[DeployTransaction])

  val transcriptGen = Gen.alphaNumStr.map(PublicTranscript.apply)

  val transitionFunctionGen = Gen.alphaNumStr.map(TransitionFunction.apply)

  val contractSourceGen = Gen.alphaNumStr.map(ContractSource.apply)

  val publicStateGen = Gen.alphaNumStr.map(PublicState.apply)

  val circuitValuesGen = (arbitrary[Int], arbitrary[Int], arbitrary[Int]).mapN(CircuitValues.apply)

  val callContractInputGen =
    (contractHashGen, transcriptGen, transitionFunctionGen, circuitValuesGen)
      .mapN(CallContractInput.apply)

  val deployContractInputGen =
    (contractSourceGen, publicStateGen).mapN(DeployContractInput.apply)

  val transitionFunctionCircuits =
    Gen
      .nonEmptyMap((Gen.alphaNumStr, Gen.alphaNumStr).tupled)
      .map(TransitionFunctionCircuits.apply)

  val proofGen = Gen.alphaNumStr.map(Proof.apply)

  val proofIdGen = Gen.alphaNumStr.map(ProofId.apply)
}
