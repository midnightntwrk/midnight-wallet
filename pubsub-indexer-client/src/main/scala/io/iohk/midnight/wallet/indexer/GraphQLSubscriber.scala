package io.iohk.midnight.wallet.indexer

import caliban.client.laminext.*
import caliban.client.ws.{GraphQLWSRequest, GraphQLWSResponse}
import caliban.client.{Operations, SelectionBuilder}
import cats.effect.{Async, Resource, Sync}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.EventStreamOps.*
import io.laminext.syntax.core.*
import io.laminext.websocket.WebSocket
import sttp.model.Uri

object GraphQLSubscriber {

  private type GraphQLWebSocket = WebSocket[GraphQLWSResponse, GraphQLWSRequest]
  private type RootSelectionBuilder[T] = SelectionBuilder[Operations.RootSubscription, T]

  def subscribe[F[_]: Async, T](
      indexerWsUri: Uri,
      selectionBuilder: RootSelectionBuilder[T],
  ): Stream[F, T] = {
    val eventStreamResource =
      webSocketResource(indexerWsUri)
        .flatMap(subscriptionResource(_, selectionBuilder))
        .map(_.received.collectRight)

    Stream.resource(eventStreamResource).flatMap(_.toStream)
  }

  private def webSocketResource[F[_]: Sync](indexerWsUri: Uri): Resource[F, GraphQLWebSocket] =
    Resource.make(connectWebSocket(indexerWsUri))(ws => Sync[F].delay(ws.disconnectNow()))

  private def connectWebSocket[F[_]: Sync](indexerWsUri: Uri): F[GraphQLWebSocket] =
    Sync[F]
      .delay(WebSocket.url(indexerWsUri.toString, "graphql-ws").graphql.build(managed = false))
      .flatTap(ws => Sync[F].delay(ws.reconnectNow()))

  private def subscriptionResource[T, F[_]: Async](
      ws: GraphQLWebSocket,
      selection: RootSelectionBuilder[T],
  ): Resource[F, Subscription[T]] =
    Resource.make(subscribeToWebSocket(ws, selection))(s => Sync[F].delay(s.unsubscribe()))

  private def subscribeToWebSocket[F[_]: Async, T](
      ws: GraphQLWebSocket,
      selection: RootSelectionBuilder[T],
  ): F[Subscription[T]] =
    ws.connected
      .map(_ => ws.init())
      .map(_ => selection.toSubscription(ws))
      .toStream
      .head
      .compile
      .lastOrError
}
