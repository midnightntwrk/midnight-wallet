package io.iohk.midnight.wallet.engine.tracing.sync

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.indexer.IndexerClient.*

sealed trait SyncServiceEvent

object SyncServiceEvent {

  /** Sync failed with an error.
    */
  final case class SyncFailed(error: Throwable) extends SyncServiceEvent

  object SyncFailed {
    val id: Event.Id[SyncFailed] = Event.Id("sync_failed")
  }

  /** Sync event received.
    */
  final case class IndexerUpdateReceived(update: IndexerEvent) extends SyncServiceEvent

  object IndexerUpdateReceived {
    val id: Event.Id[IndexerUpdateReceived] = Event.Id("viewing_update_received")
  }

  object DefaultInstances {

    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    implicit val syncFailedContext: AsStringLogContext[SyncFailed] =
      AsStringLogContext.fromMap[SyncFailed](evt => Map("error" -> evt.error.getMessage))
    // $COVERAGE-ON$

    def showIndexerUpdate(indexerUpdate: IndexerEvent): String =
      indexerUpdate match {
        case RawProgressUpdate(synced, total) => s"Progress: $synced/$total"
        case RawViewingUpdate(offset, updates) =>
          s"ViewingUpdate: @$offset ${updates
              .collect { case SingleUpdate.RawTransaction(hash, _, _) => hash }
              .mkString("[", ",", "]")}"
        case ConnectionLost => "ConnectionLost"
      }

    implicit val indexerUpdateReceivedContext: AsStringLogContext[IndexerUpdateReceived] =
      AsStringLogContext.fromMap[IndexerUpdateReceived](evt =>
        Map(
          "update" -> showIndexerUpdate(evt.update),
        ),
      )
  }
}
