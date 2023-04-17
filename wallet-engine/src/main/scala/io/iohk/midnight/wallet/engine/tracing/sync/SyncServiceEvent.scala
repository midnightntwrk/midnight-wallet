package io.iohk.midnight.wallet.engine.tracing.sync

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

sealed trait SyncServiceEvent

object SyncServiceEvent {

  /** Sync failed with an error.
    */
  final case class SyncFailed(error: Any) extends SyncServiceEvent

  object SyncFailed {
    val id: Event.Id[SyncFailed] = Event.Id("sync_failed")
  }

  /** Sync event received.
    */
  final case class BlockReceived(additionalData: Map[String, String]) extends SyncServiceEvent

  object BlockReceived {
    val id: Event.Id[BlockReceived] = Event.Id("block_received")
  }

  object DefaultInstances {

    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    implicit val syncFailedContext: AsStringLogContext[SyncFailed] =
      AsStringLogContext.fromMap[SyncFailed](evt => Map("error" -> evt.error.toString))
    // $COVERAGE-ON$

    implicit val syncEventReceivedContext: AsStringLogContext[BlockReceived] =
      AsStringLogContext.fromMap[BlockReceived](evt => Map("data" -> evt.additionalData.toString()))
  }
}
