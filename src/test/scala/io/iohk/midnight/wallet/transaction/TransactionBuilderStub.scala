package io.iohk.midnight.wallet.transaction

import cats.Id
import io.iohk.midnight.wallet.domain.*

class TransactionBuilderStub extends TransactionBuilder[Id]:
  override def buildTransaction(input: ContractInput, proof: Proof): Transaction =
    Transaction(Hash())
