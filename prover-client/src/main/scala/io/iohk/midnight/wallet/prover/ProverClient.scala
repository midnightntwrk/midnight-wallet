package io.iohk.midnight.wallet.prover

import cats.effect.{Async, Resource}
import cats.syntax.functor.*
import io.borsh4s.{Borsh4s, given}
import io.iohk.midnight.wallet.zswap.{Offer, Transaction, UnprovenOffer, UnprovenTransaction}
import scala.concurrent.duration.DurationInt
import sttp.client3.{ResponseAs, SttpBackend, UriContext, asByteArray, emptyRequest}
import sttp.model.Uri

class ProverClient[F[_]: Async](serverUri: Uri, backend: SttpBackend[F, Any]) {
  private val readTimeout = 5.minutes // TODO: Make this configurable

  private val asTransaction: ResponseAs[Transaction, Any] =
    asByteArray.getRight.map(bytes => Transaction.deserialize(bytes))

  private val asOffer: ResponseAs[Offer, Any] =
    asByteArray.getRight.map(bytes => Offer.deserialize(bytes))

  def proveTransaction(tx: UnprovenTransaction): F[Transaction] = {
    val serializedTx = tx.serialize
    val serializedEmptyMap = Borsh4s.encode[Map[Int, Int]](Map.empty)
    val body = serializedTx ++ serializedEmptyMap

    val request = emptyRequest
      .body(body)
      .post(uri"$serverUri/prove-tx")
      .response(asTransaction)
      .readTimeout(readTimeout)

    backend.send(request).map(_.body)
  }

  def proveOffer(offer: UnprovenOffer): F[Offer] = {
    val serializedOffer = offer.serialize

    val request = emptyRequest
      .body(serializedOffer)
      .post(uri"$serverUri/prove-offer")
      .response(asOffer)
      .readTimeout(readTimeout)

    backend
      .send(request)
      .map(_.body)
  }

}

object ProverClient {
  def apply[F[_]: Async](serverUri: Uri): Resource[F, ProverClient[F]] =
    SttpBackendFactory.build.map(new ProverClient[F](serverUri, _))
}
