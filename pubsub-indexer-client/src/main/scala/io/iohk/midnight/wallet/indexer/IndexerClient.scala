package io.iohk.midnight.wallet.indexer

import caliban.client.Operations.RootSubscription
import caliban.client.SelectionBuilder
import cats.effect.*
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.indexer.IndexerClient.*
import io.iohk.midnight.wallet.indexer.IndexerSchema.*
import io.iohk.midnight.wallet.indexer.tracing.IndexerClientTracer
import scala.concurrent.duration.DurationInt
import scala.scalajs.js
import scala.util.Try
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

class IndexerClient[F[_]: Async](
    indexerWsUri: Uri,
    httpClient: IndexerHttpClient[F],
    stopSignal: Deferred[F, Unit],
)(using tracer: IndexerClientTracer[F]) {

  def viewingUpdates(
      viewingKey: String,
      initialBlockHeight: Option[BigInt],
  ): Stream[F, IndexerEvent] =
    Stream
      .eval(Ref[F].of(initialBlockHeight))
      .flatMap(viewingUpdatesWithRetry(viewingKey, _))
      .interruptWhen(stopSignal.get.attempt)

  private def viewingUpdatesWithRetry(
      viewingKey: SessionId,
      blockHeightRef: Ref[F, Option[BigInt]],
  ): Stream[F, IndexerEvent] =
    Stream
      .bracket(httpClient.connect(viewingKey))(httpClient.disconnect)
      .evalMap(sessionId => blockHeightRef.get.map(buildQuery(sessionId, _)))
      .flatMap(GraphQLSubscriber.subscribe(indexerWsUri, _))
      .evalTap(update => blockHeightRef.set(update.blockHeight.some))
      .handleErrorWith(retryOnConnectionError(viewingKey, blockHeightRef))

  private def retryOnConnectionError(
      viewingKey: String,
      blockHeight: Ref[F, Option[BigInt]],
  ): Function[Throwable, Stream[F, IndexerEvent]] = {
    case err: js.JavaScriptException if isConnectionError(err) =>
      Stream
        .eval(tracer.connectionLost(err)) >>
        Stream.emit(ConnectionLost) ++
        viewingUpdatesWithRetry(viewingKey, blockHeight).delayBy(5.seconds)
    case err =>
      Stream.raiseError(err)
  }

  private def buildQuery(
      sessionId: SessionId,
      blockHeight: Option[BigInt],
  ): SelectionBuilder[RootSubscription, RawIndexerUpdate] =
    Subscription.wallet(
      sessionId,
      blockHeight,
    )(
      onViewingUpdate = (ViewingUpdate.blockHeight ~ ViewingUpdate
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
}

private class IndexerHttpClient[F[_]: Async](indexerUri: Uri, backend: SttpBackend[F, Any]) {
  def connect(viewingKey: String): F[SessionId] =
    Async[F].defer {
      Mutation
        .connect(viewingKey)
        .toRequest(indexerUri)
        .send[F, Any](backend)
        .map(_.body)
        .rethrow
    }

  def disconnect(sessionId: SessionId): F[Unit] =
    Async[F].defer {
      Mutation
        .disconnect(sessionId)
        .toRequest(indexerUri)
        .send[F, Any](backend)
        .void
    }
}

object IndexerClient {
  def apply[F[_]: Async](
      indexerUri: Uri,
      indexerWsUri: Uri,
  )(using rootTracer: Tracer[F, StructuredLog]): Resource[F, IndexerClient[F]] = {
    given IndexerClientTracer[F] = IndexerClientTracer.from(rootTracer)
    Resource
      .make(Async[F].delay(FetchCatsBackend[F]()))(_.close())
      .map(new IndexerHttpClient[F](indexerUri, _))
      .flatMap { httpClient =>
        Resource.make(Deferred[F, Unit].map(new IndexerClient(indexerWsUri, httpClient, _)))(_.stop)
      }
  }

  private val FetchErrorName = "FetchError"

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf", "org.wartremover.warts.Equals"))
  private def isConnectionError(err: js.JavaScriptException): Boolean =
    Try(FetchErrorName.equals(err.exception.asInstanceOf[js.Dynamic].name)).getOrElse(false)

  sealed trait IndexerEvent

  case object ConnectionLost extends IndexerEvent

  sealed trait RawIndexerUpdate extends IndexerEvent {
    def blockHeight: BigInt
  }

  final case class RawProgressUpdate(synced: BigInt, total: BigInt) extends RawIndexerUpdate {
    override def blockHeight: BigInt = synced
  }

  sealed trait SingleUpdate

  case object SingleUpdate {
    final case class RawTransaction(hash: String, raw: String, applyStage: String)
        extends SingleUpdate
    final case class MerkleTreeCollapsedUpdate(update: String) extends SingleUpdate
  }

  final case class RawViewingUpdate(blockHeight: BigInt, updates: Seq[SingleUpdate])
      extends RawIndexerUpdate
}
