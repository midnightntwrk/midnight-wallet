package io.iohk.midnight.wallet.store

import io.iohk.midnight.wallet.domain.{ContractId, ContractPrivateState}

trait PrivateStateStore[F[_]]:
  def getState(contractId: ContractId): F[Option[ContractPrivateState]]

  def setState(contractId: ContractId, state: ContractPrivateState): F[Unit]
