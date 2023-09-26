package io.iohk.midnight.wallet.indexer

import caliban.client.laminext.*
import caliban.client.ws.{GraphQLWSRequest, GraphQLWSResponse}
import caliban.client.{Operations, SelectionBuilder}
import cats.effect.{Async, Resource, Sync}
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.EventStreamOps.*
import io.laminext.syntax.core.*
import io.laminext.websocket.WebSocket
import sttp.model.Uri

object GraphQLSubscriber {

  def subscribe[F[_]: Async, T](
      indexerWsUri: Uri,
      subscription: SelectionBuilder[Operations.RootSubscription, T],
  ): Stream[F, T] = {
    val eventStreamResource = Resource
      .make(createEventStream(indexerWsUri, subscription)) { case (_, release) =>
        release()
      }
      .map(_._1)

    Stream.resource(eventStreamResource).flatMap(_.toStream)
  }

  private def createEventStream[F[_]: Async, T](
      indexerWsUri: Uri,
      subscription: SelectionBuilder[Operations.RootSubscription, T],
  ) = {
    for {
      ws <- Sync[F].delay(
        WebSocket.url(indexerWsUri.toString, "graphql-ws").graphql.build(managed = false),
      )
      _ <- Sync[F].delay(ws.reconnectNow())
      eventStream <- Sync[F].delay(
        ws.connected
          .map(_ => ws.init())
          .flatMap(_ => subscription.toSubscription(ws).received.collectRight),
      )
    } yield (
      eventStream,
      () => Sync[F].delay(ws.disconnectNow()),
    )
  }

}
