package io.iohk.midnight.wallet.indexer

import caliban.client.laminext.*
import caliban.client.ws.{GraphQLWSRequest, GraphQLWSResponse}
import caliban.client.{Operations, SelectionBuilder}
import cats.effect.kernel.Resource
import cats.effect.{Async, Sync}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.EventStreamOps.*
import io.laminext.websocket.WebSocket
import scala.concurrent.duration.DurationInt

object GraphQLSubscriber {

  case object WebSocketClosed extends Exception("Indexer WebSocket connection closed")

  private type GraphQLWebSocket = WebSocket[GraphQLWSResponse, GraphQLWSRequest]
  private type RootSelectionBuilder[T] = SelectionBuilder[Operations.RootSubscription, T]

  def subscribe[F[_]: Async, T](
      ws: GraphQLWebSocket,
      selectionBuilder: RootSelectionBuilder[T],
  ): Stream[F, T] = {
    val closed: F[Either[Throwable, Unit]] =
      ws.closed.toStream
        .as(WebSocketClosed.asLeft[Unit])
        .head
        .compile
        .lastOrError

    val connectionFail =
      Stream
        .awakeEvery(10.seconds)
        .evalMap(_ => Sync[F].delay(ws.sendOne(GraphQLWSRequest("ping", none, none))))
        .attempt
        .find(_.isLeft)
        .compile
        .lastOrError

    subscribeToWebSocket(ws, selectionBuilder).toStream
      .interruptWhen(closed)
      .interruptWhen(connectionFail)
  }

  private def subscribeToWebSocket[F[_]: Async, T](
      ws: GraphQLWebSocket,
      selection: RootSelectionBuilder[T],
  ): Resource[F, Subscription[T]] =
    Resource.make(Sync[F].delay(selection.toSubscription(ws)))(s => Sync[F].delay(s.unsubscribe()))
}
