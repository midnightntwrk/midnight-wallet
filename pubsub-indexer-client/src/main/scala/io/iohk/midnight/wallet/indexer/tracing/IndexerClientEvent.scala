package io.iohk.midnight.wallet.indexer.tracing

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

sealed trait IndexerClientEvent

object IndexerClientEvent {

  final case class ConnectionLost(error: Throwable) extends IndexerClientEvent

  object ConnectionLost {
    val id: Event.Id[ConnectionLost] = Event.Id("wallet_sync_connection_lost")
  }

  object DefaultInstances {
    implicit val connectionLostContext: AsStringLogContext[ConnectionLost] =
      AsStringLogContext.fromMap(evt => Map("error" -> evt.error.getMessage))
  }

}
