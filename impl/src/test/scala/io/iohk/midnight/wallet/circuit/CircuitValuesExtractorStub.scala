package io.iohk.midnight.wallet.circuit

import io.iohk.midnight.wallet.domain.{CircuitValues, ContractInput}

class CircuitValuesExtractorStub extends CircuitValuesExtractor:
  override def extractValues(input: ContractInput): CircuitValues = CircuitValues(1, 2, 3)
