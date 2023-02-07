package io.iohk.midnight.wallet.core.tracing

import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.tracer.logging.AsStringLogContext
import cats.syntax.show.*

sealed trait WalletStateEvent

object WalletStateEvent {

  final case class StateUpdateHandlingBlock(block: data.Block) extends WalletStateEvent

  object StateUpdateHandlingBlock {
    val id: Event.Id[StateUpdateHandlingBlock] = Event.Id("wallet_state_update_handling_block")
  }

  final case class StateUpdateStart(tx: data.Transaction) extends WalletStateEvent

  object StateUpdateStart {
    val id: Event.Id[StateUpdateStart] = Event.Id("wallet_state_update_start")
  }

  final case class StateUpdateSuccess(tx: data.Transaction) extends WalletStateEvent

  object StateUpdateSuccess {
    val id: Event.Id[StateUpdateSuccess] = Event.Id("wallet_state_update_success")
  }

  final case class StateUpdateError(tx: data.Transaction, error: Throwable) extends WalletStateEvent

  object StateUpdateError {
    val id: Event.Id[StateUpdateError] = Event.Id("wallet_state_update_error")
  }

  object DefaultInstances {
    implicit val stateUpdateHandlingBlockContext: AsStringLogContext[StateUpdateHandlingBlock] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_hash" -> evt.block.header.hash.show,
          "block_parent_hash" -> evt.block.header.parentHash.show,
          "block_height" -> evt.block.header.height.show,
        ),
      )
    implicit val stateUpdateStartContext: AsStringLogContext[StateUpdateStart] =
      AsStringLogContext.fromMap(evt => Map("transaction" -> evt.tx.show))
    implicit val stateUpdateSuccessContext: AsStringLogContext[StateUpdateSuccess] =
      AsStringLogContext.fromMap(evt => Map("transaction_hash" -> evt.tx.header.hash.show))
    implicit val stateUpdateErrorContext: AsStringLogContext[StateUpdateError] =
      AsStringLogContext.fromMap(evt => Map("transaction_hash" -> evt.tx.header.hash.show))
  }

}
