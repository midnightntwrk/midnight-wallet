package io.iohk.midnight.wallet.indexer

import caliban.client.Operations.RootSubscription
import caliban.client.SelectionBuilder
import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.IndexerClient.*
import io.iohk.midnight.wallet.indexer.IndexerSchema.*
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

class IndexerClient[F[_]: Async](
    indexerWsUri: Uri,
    sessionId: SessionId,
    stopSignal: Deferred[F, Unit],
) {

  def viewingUpdates(blockHeight: Option[BigInt]): Stream[F, RawIndexerUpdate] = {
    val stream = GraphQLSubscriber
      .subscribe(
        indexerWsUri,
        subscribeForViewingUpdates(sessionId, blockHeight),
      )
      .map(rawIndexerUpdate => rawIndexerUpdate)

    stream.interruptWhen(stopSignal.get.attempt)
  }

  private def subscribeForViewingUpdates(
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
      viewingKey: String,
  ): Resource[F, IndexerClient[F]] =
    Resource
      .make(Async[F].delay(FetchCatsBackend[F]()))(_.close())
      .map(new IndexerHttpClient[F](indexerUri, _))
      .flatMap(httpClient => Resource.make(httpClient.connect(viewingKey))(httpClient.disconnect))
      .flatMap { sessionId =>
        Resource.make(Deferred[F, Unit].map(new IndexerClient(indexerWsUri, sessionId, _)))(_.stop)
      }

  sealed trait RawIndexerUpdate

  final case class RawProgressUpdate(synced: BigInt, total: BigInt) extends RawIndexerUpdate

  sealed trait SingleUpdate

  object SingleUpdate {
    final case class RawTransaction(hash: String, raw: String, applyStage: String)
        extends SingleUpdate
    final case class MerkleTreeCollapsedUpdate(update: String) extends SingleUpdate
  }

  final case class RawViewingUpdate(blockHeight: BigInt, updates: Seq[SingleUpdate])
      extends RawIndexerUpdate
}
