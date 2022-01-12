package io.iohk.midnight.wallet.store

import io.iohk.midnight.wallet.domain.{Contract, ContractPrivateState}

trait PrivateStateStore[F[_]]:
  def getState(contract: Contract): F[Option[ContractPrivateState]]

  def setState(contract: Contract, state: ContractPrivateState): F[Unit]
