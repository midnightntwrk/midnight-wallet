package io.iohk.midnight.wallet.store

import cats.Id
import io.iohk.midnight.wallet.domain.{Contract, ContractPrivateState}

class InMemoryPrivateStateStore(private var state: Map[Contract, ContractPrivateState] = Map.empty)
    extends PrivateStateStore[Id]:
  override def getState(contract: Contract): Option[ContractPrivateState] =
    state.get(contract)

  override def setState(contract: Contract, contractState: ContractPrivateState): Unit =
    state += (contract, contractState)
