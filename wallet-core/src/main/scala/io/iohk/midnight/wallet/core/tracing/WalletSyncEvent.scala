package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{
  ConnectionLost,
  IndexerUpdate,
  ProgressUpdate,
  ViewingUpdate,
}

sealed trait WalletSyncEvent

object WalletSyncEvent {

  final case class SyncHandlingUpdate(update: IndexerUpdate) extends WalletSyncEvent

  object SyncHandlingUpdate {
    val id: Event.Id[SyncHandlingUpdate] = Event.Id("wallet_sync_handling_update")
  }

  final case class ApplyUpdateSuccess(update: IndexerUpdate) extends WalletSyncEvent

  object ApplyUpdateSuccess {
    val id: Event.Id[ApplyUpdateSuccess] = Event.Id("wallet_apply_update_success")
  }

  final case class ApplyUpdateError(update: IndexerUpdate, error: WalletError)
      extends WalletSyncEvent

  object ApplyUpdateError {
    val id: Event.Id[ApplyUpdateError] = Event.Id("wallet_apply_update_error")
  }

  object DefaultInstances {
    def showIndexerUpdate(update: IndexerUpdate): String =
      update match {
        case ViewingUpdate(protocolVersion, offset, updates) =>
          s"Viewing update v$protocolVersion: @${offset.show} ${updates
              .collect { case Right(tx) => tx }
              .map(_.tx.hash)
              .mkString("[", ",", "]")}"
        case ProgressUpdate(synced, total) => s"Progress: $synced/$total"
        case ConnectionLost                => "Connection lost"
      }

    implicit val syncHandlingTransactionContext: AsStringLogContext[SyncHandlingUpdate] =
      AsStringLogContext.fromEvent(evt => "update" -> showIndexerUpdate(evt.update))

    implicit val applyUpdateSuccessContext: AsStringLogContext[ApplyUpdateSuccess] =
      AsStringLogContext.fromEvent(evt => "update" -> showIndexerUpdate(evt.update))

    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    implicit val applyUpdateErrorContext: AsStringLogContext[ApplyUpdateError] =
      AsStringLogContext.fromEvent(evt => "update" -> showIndexerUpdate(evt.update))
    // $COVERAGE-ON$
  }

}
