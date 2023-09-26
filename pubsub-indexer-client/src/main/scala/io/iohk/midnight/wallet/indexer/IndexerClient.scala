package io.iohk.midnight.wallet.indexer

import cats.effect.kernel.Concurrent
import cats.effect.{Async, Resource}
import cats.syntax.applicative.*
import cats.syntax.functor.*
import cats.syntax.monadError.*
import fs2.Stream
import io.iohk.midnight.wallet.indexer.IndexerClient.RawTransaction
import io.iohk.midnight.wallet.indexer.IndexerSchema.*
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

class IndexerClient[F[_]: Async: Concurrent](
    indexerUri: Uri,
    indexerWsUri: Uri,
    backend: SttpBackend[F, Any],
) {

  def rawTransactions(
      viewingKey: String,
      lastHash: Option[String] = None,
  ): Stream[F, RawTransaction] = {
    for {
      sessionId <- Stream.resource(
        Resource.make(connect(viewingKey))(disconnect),
      )
      (hash, rawTx) <- GraphQLSubscriber.subscribe(
        indexerWsUri,
        subscribeForTransactions(Some(sessionId), lastHash),
      )
    } yield RawTransaction(hash, rawTx)
  }

  private def connect(viewingKey: String) = {
    Mutation
      .connect(viewingKey)
      .toRequest(indexerUri)
      .send[F, Any](backend)
      .map(_.body)
      .rethrow
  }

  private def subscribeForTransactions(
      sessionId: Option[SessionId],
      lastHash: Option[String],
  ) = Subscription.transactions(sessionId, lastHash)(onTransactionAdded =
    TransactionAdded.transaction(Transaction.hash ~ Transaction.raw),
  )

  private def disconnect(sessionId: SessionId) = {
    Mutation
      .disconnect(sessionId)
      .toRequest(indexerUri)
      .send[F, Any](backend)
      .map(_.body.getOrElse(()))
  }

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
}
