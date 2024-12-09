package io.iohk.midnight.wallet.indexer

import caliban.client.Operations.RootSubscription
import caliban.client.SelectionBuilder
import caliban.client.__Value.{__ObjectValue, __StringValue}
import caliban.client.laminext.*
import caliban.client.ws.{GraphQLWSRequest, GraphQLWSResponse}
import cats.effect.*
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.js.interop.{JsResource, TracerCarrier}
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.IndexerEvent
import io.iohk.midnight.wallet.blockchain.data.IndexerEvent.*
import io.iohk.midnight.wallet.indexer.EventStreamOps.*
import io.iohk.midnight.wallet.indexer.GraphQLSubscriber.WebSocketClosed
import io.iohk.midnight.wallet.indexer.IndexerClient.*
import io.iohk.midnight.wallet.indexer.IndexerSchema.*
import io.iohk.midnight.wallet.indexer.tracing.IndexerClientTracer
import io.laminext.websocket.WebSocket
import sttp.model.Uri

import java.util.UUID
import scala.concurrent.TimeoutException
import scala.concurrent.duration.DurationInt
import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportAll, JSExportTopLevel}
import scala.util.Try

@JSExportTopLevel("IndexerClientInstance")
@JSExportAll
class IndexerClient(
    indexerUri: Uri,
    stopSignal: Deferred[IO, Unit],
)(using tracer: IndexerClientTracer) {

  def viewingUpdates(viewingKey: String, initialIndex: Option[BigInt]): Stream[IO, IndexerEvent] =
    Stream
      .eval(Ref[IO].of(initialIndex))
      .flatMap(viewingUpdatesWithRetry(viewingKey, _))
      .interruptWhen(stopSignal.get.attempt)

  private def viewingUpdatesWithRetry(
      viewingKey: String,
      indexRef: Ref[IO, Option[BigInt]],
  ): Stream[IO, IndexerEvent] = {
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    val requestId = UUID.randomUUID().toString

    Stream.resource(webSocketResource(indexerUri)).flatMap { ws =>
      Stream
        .bracket(connect(viewingKey, requestId, ws))(disconnect(_, requestId, ws))
        .evalMap(sessionId => indexRef.get.map(buildQuery(sessionId, _)))
        .flatMap(GraphQLSubscriber.subscribe(ws, _))
        .evalTap {
          case RawViewingUpdate(index, _) => indexRef.set(index.some)
          case _                          => Async[IO].unit
        }
        .handleErrorWith(retryOnConnectionError(viewingKey, indexRef))
    }
  }

  private def webSocketResource(indexerUri: Uri): Resource[IO, GraphQLWebSocket] =
    Resource.make(connectWebSocket(indexerUri))(ws => Sync[IO].delay(ws.disconnectNow()))

  private def connectWebSocket(indexerUri: Uri): IO[GraphQLWebSocket] = {
    val host = indexerUri.host.getOrElse("")
    val scheme = indexerUri.scheme.fold("")(scheme => s"$scheme://")
    val port = indexerUri.port.fold("")(port => s":$port")
    val wsUri = s"$scheme$host$port/api/v1/graphql/ws"
    Sync[IO]
      .delay(WebSocket.url(wsUri, "graphql-ws").graphql.build(managed = false))
      .flatTap(ws => Sync[IO].delay(ws.reconnectNow()))
      .flatTap(ws => Sync[IO].delay(ws.init()))
  }

  private def retryOnConnectionError(
      viewingKey: String,
      index: Ref[IO, Option[BigInt]],
  ): Function[Throwable, Stream[IO, IndexerEvent]] = {
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
          (MerkleTreeCollapsedUpdate.protocolVersion ~ MerkleTreeCollapsedUpdate.update)
            .map(SingleUpdate.MerkleTreeCollapsedUpdate.apply),
          RelevantTransaction
            .transaction(
              Transaction.protocolVersion ~ Transaction.hash ~ Transaction.raw ~ Transaction.applyStage,
            )
            .map(SingleUpdate.RawTransaction.apply.tupled),
        )).map(RawViewingUpdate.apply),
      onProgressUpdate = (ProgressUpdate.synced ~ ProgressUpdate.total).map(RawProgressUpdate.apply),
    )

  private def stop: IO[Unit] =
    stopSignal.complete(()).void

  private def connect(
      viewingKey: String,
      requestId: String,
      ws: WebSocket[GraphQLWSResponse, GraphQLWSRequest],
  ): IO[SessionId] =
    Async[IO].defer {
      val selection = Mutation.connect(viewingKey)
      val request = GraphQLWSRequest("start", Some(requestId), selection.toGraphQL().some)
      Sync[IO].delay(ws.sendOne(request)) >> waitForSessionId(ws, requestId)
    }

  private def waitForSessionId(
      ws: WebSocket[GraphQLWSResponse, GraphQLWSRequest],
      requestId: String,
  ): IO[String] =
    ws.received.toStream
      .collectFirst(matchSessionId(requestId))
      .timeout(5.seconds)
      .compile
      .lastOrError

  private def matchSessionId(requestId: String): PartialFunction[GraphQLWSResponse, String] = {
    case GraphQLWSResponse(
          _,
          reqIdOpt,
          Some(
            __ObjectValue(
              List(("data", __ObjectValue(List(("connect", __StringValue(sessionId)))))),
            ),
          ),
        ) if reqIdOpt.contains(requestId) =>
      sessionId
  }

  private def disconnect(sessionId: SessionId, requestId: String, ws: GraphQLWebSocket): IO[Unit] =
    Async[IO].defer {
      val selection = Mutation.disconnect(sessionId)
      val request = GraphQLWSRequest("start", Some(requestId), selection.toGraphQL().some)
      Sync[IO].delay(ws.sendOne(request))
    }
}
@JSExportTopLevel("IndexerClient")
object IndexerClient {
  private type GraphQLWebSocket = WebSocket[GraphQLWSResponse, GraphQLWSRequest]

  def apply(
      indexerWsUri: Uri,
  )(using rootTracer: Tracer[IO, StructuredLog]): Resource[IO, IndexerClient] = {
    given IndexerClientTracer = IndexerClientTracer.from(rootTracer)
    Resource.make(Deferred[IO, Unit].map(new IndexerClient(indexerWsUri, _)))(_.stop)
  }

  @JSExport def create(
      indexerWsUri: String,
      rootTracer: TracerCarrier[StructuredLog],
  ): JsResource[IndexerClient] = {
    given Tracer[IO, StructuredLog] = rootTracer.tracer
    val parsedUri = Uri.parse(indexerWsUri).leftMap(InvalidUri.apply)
    val resource: Resource[IO, IndexerClient] =
      Resource.eval(parsedUri.liftTo[IO]).flatMap(IndexerClient.apply)
    JsResource.fromCats(resource)
  }

  private val FetchErrorName = "FetchError"

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf", "org.wartremover.warts.Equals"))
  private def isConnectionError(err: js.JavaScriptException): Boolean =
    Try(FetchErrorName.equals(err.exception.asInstanceOf[js.Dynamic].name)).getOrElse(false)

  final case class InvalidUri(msg: String) extends Throwable(msg)
}
