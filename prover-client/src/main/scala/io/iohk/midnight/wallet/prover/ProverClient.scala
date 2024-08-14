package io.iohk.midnight.wallet.prover

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.zswap.{Transaction, UnprovenTransaction}
import scala.concurrent.duration.DurationInt
import sttp.client3.{ResponseAs, SttpBackend, UriContext, asByteArray, emptyRequest}
import sttp.model.Uri

class ProverClient[F[_]: Async](serverUri: Uri, backend: SttpBackend[F, Any]) {
  private val readTimeout = 20.minutes // TODO: Make this configurable

  private val asTransaction: ResponseAs[Transaction, Any] =
    asByteArray.getRight.map(bytes => Transaction.deserialize(bytes))

  private val borshSerializedEmptyMap = Array[Byte](0, 0, 0, 0)

  def proveTransaction(tx: UnprovenTransaction): F[Transaction] = {
    val serializedTx = tx.serialize
    val body = serializedTx ++ borshSerializedEmptyMap

    val request = emptyRequest
      .body(body)
      .post(uri"$serverUri/prove-tx")
      .response(asTransaction)
      .readTimeout(readTimeout)

    backend.send(request).map(_.body).adaptError { case error =>
      Exception(s"There was an error proving the transaction: ${error.getMessage}", error)
    }
  }
}

object ProverClient {
  def apply[F[_]: Async](serverUri: Uri): Resource[F, ProverClient[F]] =
    SttpBackendFactory.build.map(new ProverClient[F](serverUri, _))
}
