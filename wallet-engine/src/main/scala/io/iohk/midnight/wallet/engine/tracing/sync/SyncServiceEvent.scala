package io.iohk.midnight.wallet.engine.tracing.sync

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.indexer.IndexerClient.{RawViewingUpdate, SingleUpdate}

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
  final case class ViewingUpdateReceived(update: RawViewingUpdate) extends SyncServiceEvent

  object ViewingUpdateReceived {
    val id: Event.Id[ViewingUpdateReceived] = Event.Id("viewing_update_received")
  }

  object DefaultInstances {

    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    implicit val syncFailedContext: AsStringLogContext[SyncFailed] =
      AsStringLogContext.fromMap[SyncFailed](evt => Map("error" -> evt.error.getMessage))
    // $COVERAGE-ON$

    implicit val viewingUpdateReceivedContext: AsStringLogContext[ViewingUpdateReceived] =
      AsStringLogContext.fromMap[ViewingUpdateReceived](evt =>
        Map(
          "transaction_hashes" -> evt.update.updates
            .collect { case SingleUpdate.RawTransaction(hash, _) => hash }
            .mkString("[", ",", "]"),
        ),
      )
  }
}
