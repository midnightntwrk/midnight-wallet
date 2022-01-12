package io.iohk.midnight.wallet.transaction

import io.iohk.midnight.wallet.domain.{ContractInput, Proof, Transaction}

trait TransactionBuilder[F[_]]:
  def buildTransaction(input: ContractInput, proof: Proof): F[Transaction]
