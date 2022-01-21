package io.iohk.midnight.wallet.circuit

import io.iohk.midnight.wallet.domain.{
  CallContractInput,
  CircuitValues,
  DeployContractInput,
  TransitionFunction,
  TransitionFunctionCircuits,
}

class CircuitValuesExtractorStub extends CircuitValuesExtractor:
  override def extractValues(input: CallContractInput): CircuitValues = CircuitValues(1, 2, 3)

  def extractTransitionFunctionCircuits(input: DeployContractInput): TransitionFunctionCircuits =
    TransitionFunctionCircuits()
