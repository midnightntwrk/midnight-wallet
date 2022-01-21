package io.iohk.midnight.wallet.circuit

import io.iohk.midnight.wallet.domain.{
  CallContractInput,
  CircuitValues,
  DeployContractInput,
  TransitionFunctionCircuits,
}

trait CircuitValuesExtractor:
  def extractValues(input: CallContractInput): CircuitValues

  def extractTransitionFunctionCircuits(input: DeployContractInput): TransitionFunctionCircuits
