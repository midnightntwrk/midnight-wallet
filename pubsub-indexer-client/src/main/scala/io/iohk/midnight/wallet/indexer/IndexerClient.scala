package io.iohk.midnight.wallet.indexer

import caliban.client.Operations.RootSubscription
import caliban.client.SelectionBuilder
import caliban.client.__Value.{__ObjectValue, __StringValue}
import caliban.client.laminext.*
import caliban.client.ws.{GraphQLWSRequest, GraphQLWSResponse}
import cats.effect.*
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.indexer.EventStreamOps.*
import io.iohk.midnight.wallet.indexer.GraphQLSubscriber.WebSocketClosed
import io.iohk.midnight.wallet.indexer.IndexerClient.*
import io.iohk.midnight.wallet.indexer.IndexerSchema.*
import io.iohk.midnight.wallet.indexer.tracing.IndexerClientTracer
import io.laminext.websocket.WebSocket
import scala.concurrent.TimeoutException
import scala.concurrent.duration.DurationInt
import scala.scalajs.js
import scala.util.Try
import sttp.model.Uri

class IndexerClient[F[_]: Async](
    indexerWsUri: Uri,
    stopSignal: Deferred[F, Unit],
)(using tracer: IndexerClientTracer[F]) {

  def viewingUpdates(
      viewingKey: String,
      initialIndex: Option[BigInt],
  ): Stream[F, IndexerEvent] =
    Stream
      .eval(Ref[F].of(initialIndex))
      .flatMap(viewingUpdatesWithRetry(viewingKey, _))
      .interruptWhen(stopSignal.get.attempt)

  private def viewingUpdatesWithRetry(
      viewingKey: String,
      indexRef: Ref[F, Option[BigInt]],
  ): Stream[F, IndexerEvent] =
    Stream.resource(webSocketResource(indexerWsUri)).flatMap { ws =>
      Stream
        .bracket(connect(viewingKey, ws))(disconnect(_, ws))
        .evalMap(sessionId => indexRef.get.map(buildQuery(sessionId, _)))
        .flatMap(GraphQLSubscriber.subscribe(ws, _))
        .evalTap {
          case RawViewingUpdate(index, _) => indexRef.set(index.some)
          case _                          => Async[F].unit
        }
        .handleErrorWith(retryOnConnectionError(viewingKey, indexRef))
    }

  private def webSocketResource(indexerWsUri: Uri): Resource[F, GraphQLWebSocket] =
    Resource.make(connectWebSocket(indexerWsUri))(ws => Sync[F].delay(ws.disconnectNow()))

  private def connectWebSocket(indexerWsUri: Uri): F[GraphQLWebSocket] =
    Sync[F]
      .delay(WebSocket.url(indexerWsUri.toString, "graphql-ws").graphql.build(managed = false))
      .flatTap(ws => Sync[F].delay(ws.reconnectNow()))
      .flatTap(ws => Sync[F].delay(ws.init()))

  private def retryOnConnectionError(
      viewingKey: String,
      index: Ref[F, Option[BigInt]],
  ): Function[Throwable, Stream[F, IndexerEvent]] = {
    case err: js.JavaScriptException if isConnectionError(err) =>
      Stream
        .eval(tracer.connectionLost(err)) >>
        Stream.emit(ConnectionLost) ++
        viewingUpdatesWithRetry(viewingKey, index).delayBy(5.seconds)
    case WebSocketClosed =>
      Stream
        .eval(tracer.connectionLost(WebSocketClosed)) >>
        Stream.emit(ConnectionLost) ++
        viewingUpdatesWithRetry(viewingKey, index).delayBy(5.seconds)
    case _: TimeoutException =>
      Stream
        .eval(tracer.connectTimeout) >>
        Stream.emit(ConnectionLost) ++
        viewingUpdatesWithRetry(viewingKey, index)
    case err =>
      Stream.raiseError(err)
  }

  private def buildQuery(
      sessionId: SessionId,
      index: Option[BigInt],
  ): SelectionBuilder[RootSubscription, RawIndexerUpdate] =
    Subscription.wallet(
      sessionId,
      index,
    )(
      onViewingUpdate = (ViewingUpdate.index ~ ViewingUpdate
        .update[SingleUpdate](
          MerkleTreeCollapsedUpdate.update.map(SingleUpdate.MerkleTreeCollapsedUpdate.apply),
          RelevantTransaction
            .transaction(Transaction.hash ~ Transaction.raw ~ Transaction.applyStage)
            .map(SingleUpdate.RawTransaction.apply.tupled),
        )).map(RawViewingUpdate.apply),
      onProgressUpdate = (ProgressUpdate.synced ~ ProgressUpdate.total).map(RawProgressUpdate.apply),
    )

  private def stop: F[Unit] =
    stopSignal.complete(()).void

  private def connect(
      viewingKey: String,
      ws: WebSocket[GraphQLWSResponse, GraphQLWSRequest],
  ): F[SessionId] =
    Async[F].defer {
      val selection = Mutation.connect(viewingKey)
      val request = GraphQLWSRequest("start", None, selection.toGraphQL().some)
      Sync[F].delay(ws.sendOne(request)) >> waitForSessionId(ws)
    }

  private def waitForSessionId(ws: WebSocket[GraphQLWSResponse, GraphQLWSRequest]): F[String] =
    ws.received.toStream
      .collectFirst(matchSessionId)
      .timeout(5.seconds)
      .compile
      .lastOrError

  private val matchSessionId: PartialFunction[GraphQLWSResponse, String] = {
    case GraphQLWSResponse(
          _,
          _,
          Some(
            __ObjectValue(
              List(("data", __ObjectValue(List(("connect", __StringValue(sessionId)))))),
            ),
          ),
        ) =>
      sessionId
  }

  private def disconnect(sessionId: SessionId, ws: GraphQLWebSocket): F[Unit] =
    Async[F].defer {
      val selection = Mutation.disconnect(sessionId)
      val request = GraphQLWSRequest("start", None, selection.toGraphQL().some)
      Sync[F].delay(ws.sendOne(request))
    }
}

object IndexerClient {
  private type GraphQLWebSocket = WebSocket[GraphQLWSResponse, GraphQLWSRequest]

  def apply[F[_]: Async](
      indexerWsUri: Uri,
  )(using rootTracer: Tracer[F, StructuredLog]): Resource[F, IndexerClient[F]] = {
    given IndexerClientTracer[F] = IndexerClientTracer.from(rootTracer)
    Resource.make(Deferred[F, Unit].map(new IndexerClient(indexerWsUri, _)))(_.stop)
  }

  private val FetchErrorName = "FetchError"

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf", "org.wartremover.warts.Equals"))
  private def isConnectionError(err: js.JavaScriptException): Boolean =
    Try(FetchErrorName.equals(err.exception.asInstanceOf[js.Dynamic].name)).getOrElse(false)

  sealed trait IndexerEvent

  case object ConnectionLost extends IndexerEvent

  sealed trait RawIndexerUpdate extends IndexerEvent

  final case class RawProgressUpdate(synced: BigInt, total: BigInt) extends RawIndexerUpdate

  sealed trait SingleUpdate

  case object SingleUpdate {
    final case class RawTransaction(hash: String, raw: String, applyStage: String)
        extends SingleUpdate
    final case class MerkleTreeCollapsedUpdate(update: String) extends SingleUpdate
  }

  final case class RawViewingUpdate(index: BigInt, updates: Seq[SingleUpdate])
      extends RawIndexerUpdate
}
