package io.iohk.midnight.wallet.indexer.tracing

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

sealed trait IndexerClientEvent

object IndexerClientEvent {

  final case class ConnectionLost(error: Throwable) extends IndexerClientEvent

  object ConnectionLost {
    val id: Event.Id[ConnectionLost] = Event.Id("wallet_sync_connection_lost")
  }

  case object ConnectTimeout extends IndexerClientEvent {
    val id: Event.Id[ConnectTimeout.type] = Event.Id("wallet_sync_connect_timeout")
  }

  object DefaultInstances {
    implicit val connectionLostContext: AsStringLogContext[ConnectionLost] =
      AsStringLogContext.fromEvent(evt => "error" -> evt.error.getMessage)
    implicit val connectTimeoutContext: AsStringLogContext[ConnectTimeout.type] =
      AsStringLogContext.empty
  }

}
