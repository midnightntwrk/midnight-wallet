package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators:
  val contractGen = Gen.delay(Gen.const(Contract()))

  val contractPrivateStateGen = Gen.delay(Gen.const(ContractPrivateState()))

  val contractPublicStateGen = Gen.delay(Gen.const(ContractPublicState()))

  val contractStateGen = (contractPrivateStateGen, contractPublicStateGen).mapN(ContractState.apply)

  val transcriptGen = Gen.delay(Gen.const(Transcript()))

  val contractInputGen = (contractGen, transcriptGen, contractStateGen).mapN(ContractInput.apply)
