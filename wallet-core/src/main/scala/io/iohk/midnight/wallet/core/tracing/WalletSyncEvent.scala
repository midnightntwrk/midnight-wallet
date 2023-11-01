package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.ViewingUpdate

sealed trait WalletSyncEvent

object WalletSyncEvent {

  final case class SyncHandlingUpdate(update: ViewingUpdate) extends WalletSyncEvent

  object SyncHandlingUpdate {
    val id: Event.Id[SyncHandlingUpdate] = Event.Id("wallet_sync_handling_update")
  }

  final case class ApplyUpdateSuccess(update: ViewingUpdate) extends WalletSyncEvent

  object ApplyUpdateSuccess {
    val id: Event.Id[ApplyUpdateSuccess] = Event.Id("wallet_apply_update_success")
  }

  final case class ApplyUpdateError(update: ViewingUpdate, error: WalletError)
      extends WalletSyncEvent

  object ApplyUpdateError {
    val id: Event.Id[ApplyUpdateError] = Event.Id("wallet_apply_update_error")
  }

  object DefaultInstances {
    implicit val syncHandlingTransactionContext: AsStringLogContext[SyncHandlingUpdate] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_height" -> evt.update.blockHeight.show,
          "transaction_hashes" -> evt.update.updates
            .collect { case Right(tx) => tx }
            .map(_.tx.hash)
            .mkString("[", ",", "]"),
        ),
      )
    implicit val applyUpdateSuccessContext: AsStringLogContext[ApplyUpdateSuccess] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_height" -> evt.update.blockHeight.show,
          "transaction_hashes" -> evt.update.updates
            .collect { case Right(tx) => tx }
            .map(_.tx.hash)
            .mkString("[", ",", "]"),
        ),
      )
    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    implicit val applyUpdateErrorContext: AsStringLogContext[ApplyUpdateError] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_height" -> evt.update.blockHeight.show,
          "transaction_hashes" -> evt.update.updates
            .collect { case Right(tx) => tx }
            .map(_.tx.hash)
            .mkString("[", ",", "]"),
          "error" -> evt.error.message,
        ),
      )
    // $COVERAGE-ON$
  }

}
