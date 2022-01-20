package io.iohk.midnight.wallet.store

import cats.effect.SyncIO
import cats.syntax.all.*
import io.iohk.midnight.wallet.domain.{ContractId, ContractPrivateState}

class InMemoryPrivateStateStore(
    private var state: Map[ContractId, ContractPrivateState] = Map.empty,
) extends PrivateStateStore[SyncIO]:
  override def getState(contractId: ContractId): SyncIO[Option[ContractPrivateState]] =
    SyncIO(state.get(contractId))

  override def setState(contractId: ContractId, contractState: ContractPrivateState): SyncIO[Unit] =
    SyncIO(state += (contractId, contractState))
