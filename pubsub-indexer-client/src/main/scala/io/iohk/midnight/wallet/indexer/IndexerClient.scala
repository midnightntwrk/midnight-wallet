package io.iohk.midnight.wallet.indexer

import caliban.client.Operations.RootSubscription
import caliban.client.SelectionBuilder
import cats.effect.kernel.Concurrent
import cats.effect.{Async, Resource}
import cats.syntax.applicative.*
import cats.syntax.functor.*
import cats.syntax.monadError.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.IndexerClient.{RawViewingUpdate, SingleUpdate}
import io.iohk.midnight.wallet.indexer.IndexerSchema.*
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

class IndexerClient[F[_]: Async: Concurrent](
    indexerUri: Uri,
    indexerWsUri: Uri,
    backend: SttpBackend[F, Any],
) {

  def viewingUpdates(
      viewingKey: String,
      blockHeight: Option[BigInt],
  ): Stream[F, RawViewingUpdate] =
    for {
      sessionId <- Stream.resource(
        Resource.make(connect(viewingKey))(disconnect),
      )
      (blockHeight, updates) <- GraphQLSubscriber.subscribe(
        indexerWsUri,
        subscribeForViewingUpdates(Some(sessionId), blockHeight),
      )
    } yield RawViewingUpdate(blockHeight, updates)

  private def connect(viewingKey: String) =
    Mutation
      .connect(viewingKey)
      .toRequest(indexerUri)
      .send[F, Any](backend)
      .map(_.body)
      .rethrow

  private def subscribeForViewingUpdates(
      sessionId: Option[SessionId],
      blockHeight: Option[BigInt],
  ): SelectionBuilder[RootSubscription, (BigInt, List[SingleUpdate])] =
    Subscription.wallet(
      sessionId,
      blockHeight,
    )(onViewingUpdate =
      ViewingUpdate.blockHeight ~ ViewingUpdate
        .update[SingleUpdate](
          MerkleTreeCollapsedUpdate.update.map(SingleUpdate.MerkleTreeCollapsedUpdate.apply),
          RelevantTransaction
            .transaction(Transaction.hash ~ Transaction.raw)
            .map(SingleUpdate.RawTransaction.apply.tupled),
        ),
    )

  private def disconnect(sessionId: SessionId) =
    Mutation
      .disconnect(sessionId)
      .toRequest(indexerUri)
      .send[F, Any](backend)
      .map(_.body.getOrElse(()))

}

object IndexerClient {
  def apply[F[_]: Async: Concurrent](
      indexerUri: Uri,
      indexerWsUri: Uri,
  ): Resource[F, IndexerClient[F]] = {
    val backend = FetchCatsBackend[F]()
    Resource.make(backend.pure)(_.close()).map(new IndexerClient[F](indexerUri, indexerWsUri, _))
  }

  sealed trait SingleUpdate

  object SingleUpdate {
    final case class RawTransaction(hash: String, raw: String) extends SingleUpdate
    final case class MerkleTreeCollapsedUpdate(update: String) extends SingleUpdate
  }

  final case class RawViewingUpdate(blockHeight: BigInt, updates: Seq[SingleUpdate])
}
