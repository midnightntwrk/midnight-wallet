package io.iohk.midnight.wallet.indexer

import caliban.client.laminext.*
import caliban.client.ws.{GraphQLWSRequest, GraphQLWSResponse}
import caliban.client.{Operations, SelectionBuilder}
import cats.effect.kernel.Resource
import cats.effect.{IO, Sync}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.EventStreamOps.*
import io.laminext.websocket.WebSocket

import scala.concurrent.duration.DurationInt

object GraphQLSubscriber {

  case object WebSocketClosed extends Exception("Indexer WebSocket connection closed")

  private type GraphQLWebSocket = WebSocket[GraphQLWSResponse, GraphQLWSRequest]
  private type RootSelectionBuilder[T] = SelectionBuilder[Operations.RootSubscription, T]

  def subscribe[T](
      ws: GraphQLWebSocket,
      selectionBuilder: RootSelectionBuilder[T],
  ): Stream[IO, T] = {
    val closed: IO[Either[Throwable, Unit]] =
      ws.closed.toStream
        .as(WebSocketClosed.asLeft[Unit])
        .head
        .compile
        .lastOrError

    val connectionFail =
      Stream
        .awakeEvery[IO](10.seconds)
        .evalMap(_ => IO.delay(ws.sendOne(GraphQLWSRequest("ping", none, none))))
        .attempt
        .find(_.isLeft)
        .compile
        .lastOrError

    subscribeToWebSocket(ws, selectionBuilder).toStream
      .interruptWhen(closed)
      .interruptWhen(connectionFail)
  }

  private def subscribeToWebSocket[T](
      ws: GraphQLWebSocket,
      selection: RootSelectionBuilder[T],
  ): Resource[IO, Subscription[T]] =
    Resource.make(Sync[IO].delay(selection.toSubscription(ws)))(s =>
      Sync[IO].delay(s.unsubscribe()),
    )
}
