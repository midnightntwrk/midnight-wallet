package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators:
  val contractHashGen = Gen.delay(Gen.const(Hash()))

  val transcriptGen = Gen.delay(Gen.const(PublicTranscript()))

  val transitionFunctionGen = Gen.delay(Gen.const(TransitionFunction()))

  val contractSourceGen = Gen.delay(Gen.const(ContractSource()))

  val callContractInputGen =
    (contractHashGen, transcriptGen, transitionFunctionGen)
      .mapN(CallContractInput.apply)

  val deployContractInputGen =
    (contractSourceGen)
      .map(DeployContractInput.apply)

  val transitionFunctionCircuits = Gen.delay((Gen.const(TransitionFunctionCircuits())))
