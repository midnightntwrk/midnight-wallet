package io.iohk.midnight.wallet.domain

import cats.syntax.all.*
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators:
  val contractIdGen = Gen.delay(Gen.const(ContractId()))

  val transcriptGen = Gen.delay(Gen.const(PublicTranscript()))

  val transitionFunctionGen = Gen.delay(Gen.const(TransitionFunction()))

  val contractInputGen =
    (contractIdGen, transcriptGen, transitionFunctionGen)
      .mapN(ContractInput.apply)
