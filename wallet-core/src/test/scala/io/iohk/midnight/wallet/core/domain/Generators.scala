package io.iohk.midnight.wallet.core.domain

import cats.syntax.apply.*
import io.iohk.midnight.wallet.blockchain.data.Generators.*
import io.iohk.midnight.wallet.blockchain.data.{CallTransaction, DeployTransaction}
import io.iohk.midnight.wallet.core.Wallet.{CallContractInput, DeployContractInput}
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  val callContractInputGen: Gen[CallContractInput] =
    (
      hashGen[CallTransaction],
      addressGen,
      functionNameGen,
      nonceGen,
      transcriptGen,
      circuitValuesGen,
    )
      .mapN(CallContractInput.apply)

  val deployContractInputGen: Gen[DeployContractInput] =
    (hashGen[DeployTransaction], contractGen, transitionFunctionCircuitsGen)
      .mapN(DeployContractInput.apply)
}
