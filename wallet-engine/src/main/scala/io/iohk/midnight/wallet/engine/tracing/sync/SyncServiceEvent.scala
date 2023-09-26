package io.iohk.midnight.wallet.engine.tracing.sync

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

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
  final case class TransactionReceived(txHash: String) extends SyncServiceEvent

  object TransactionReceived {
    val id: Event.Id[TransactionReceived] = Event.Id("transaction_received")
  }

  object DefaultInstances {

    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    implicit val syncFailedContext: AsStringLogContext[SyncFailed] =
      AsStringLogContext.fromMap[SyncFailed](evt => Map("error" -> evt.error.getMessage))
    // $COVERAGE-ON$

    implicit val syncEventReceivedContext: AsStringLogContext[TransactionReceived] =
      AsStringLogContext.fromMap[TransactionReceived](evt => Map("transaction_hash" -> evt.txHash))
  }
}
