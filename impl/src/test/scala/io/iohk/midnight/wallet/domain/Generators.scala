package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators:
  val contractIdGen = Gen.delay(Gen.const(ContractId()))

  val contractPrivateStateGen = Gen.delay(Gen.const(ContractPrivateState()))

  val contractPublicStateGen = Gen.delay(Gen.const(ContractPublicState()))

  val contractStateGen = (contractPrivateStateGen, contractPublicStateGen).mapN(ContractState.apply)

  val transcriptGen = Gen.delay(Gen.const(PublicTranscript()))

  val transitionFunctionGen = Gen.delay(Gen.const(TransitionFunction()))

  val contractInputGen =
    (contractIdGen, transcriptGen, contractStateGen, transitionFunctionGen)
      .mapN(ContractInput.apply)
