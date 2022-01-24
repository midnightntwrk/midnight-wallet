package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import io.iohk.midnight.wallet.api.WalletAPI.*
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators:
  val contractHashGen = Gen.delay(Gen.const(DeployTransaction.Hash()))

  val transcriptGen = Gen.delay(Gen.const(PublicTranscript()))

  val transitionFunctionGen = Gen.delay(Gen.const(TransitionFunction()))

  val contractSourceGen = Gen.delay(Gen.const(ContractSource()))

  val circuitValuesGen = Gen.delay(Gen.const(CircuitValues(1, 2, 5)))

  val callContractInputGen =
    (contractHashGen, transcriptGen, transitionFunctionGen, circuitValuesGen)
      .mapN(CallContractInput.apply)

  val deployContractInputGen =
    contractSourceGen.map(DeployContractInput.apply)

  val transitionFunctionCircuits = Gen.delay((Gen.const(TransitionFunctionCircuits())))
