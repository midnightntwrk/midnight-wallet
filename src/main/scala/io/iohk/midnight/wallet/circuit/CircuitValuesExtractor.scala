package io.iohk.midnight.wallet.circuit

import io.iohk.midnight.wallet.domain.{CircuitValues, ContractInput}

trait CircuitValuesExtractor:
  def extractValues(input: ContractInput): CircuitValues
