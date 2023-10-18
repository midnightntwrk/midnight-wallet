package io.iohk.midnight.wallet.indexer

import caliban.client.SelectionBuilder
import cats.effect.kernel.Concurrent
import cats.effect.{Async, Resource}
import cats.syntax.applicative.*
import cats.syntax.functor.*
import cats.syntax.monadError.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.IndexerClient.{RawTransaction, RawViewingUpdate}
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
      lastHash: Option[String] = None,
      lastIndex: Option[BigInt] = None,
  ): Stream[F, RawViewingUpdate] =
    for {
      sessionId <- Stream.resource(
        Resource.make(connect(viewingKey))(disconnect),
      )
      (merkleTreeUpdate, txs) <- GraphQLSubscriber.subscribe(
        indexerWsUri,
        subscribeForViewingUpdates(Some(sessionId), lastHash, lastIndex),
      )
    } yield RawViewingUpdate(merkleTreeUpdate, txs.map(RawTransaction.apply))

  private def connect(viewingKey: String) =
    Mutation
      .connect(viewingKey)
      .toRequest(indexerUri)
      .send[F, Any](backend)
      .map(_.body)
      .rethrow

  private def subscribeForViewingUpdates(
      sessionId: Option[SessionId],
      lastHash: Option[String],
      lastIndex: Option[BigInt],
  ) =
    Subscription.wallet(
      sessionId,
      lastHash.map(hash => TransactionOffsetInput(Some(hash))),
      lastIndex,
    )(onViewingUpdate =
      ViewingUpdate.merkleTreeCollapsedUpdate(
        MerkleTreeCollapsedUpdate.update ~ MerkleTreeCollapsedUpdate.lastIndex,
      ) ~ ViewingUpdate.transactions(Transaction.hash ~ Transaction.raw),
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

  final case class RawTransaction(hash: String, raw: String)

  final case class RawViewingUpdate(
      collapsedMerkleTree: Option[(String, BigInt)],
      transactions: Seq[RawTransaction],
  )
}
