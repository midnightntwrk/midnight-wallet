package io.iohk.midnight.wallet.prover

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.zswap
import sttp.client3.{ResponseAs, SttpBackend, UriContext, asByteArray, emptyRequest}
import sttp.model.Uri

import scala.concurrent.duration.DurationInt

class ProverClient[UnprovenTransaction, Transaction](
    serverUri: Uri,
    backend: SttpBackend[IO, Any],
)(using
    txSerializable: zswap.Transaction.IsSerializable[Transaction],
)(using
    zswap.UnprovenTransaction.IsSerializable[UnprovenTransaction],
    zswap.NetworkId,
) {
  private val readTimeout = 20.minutes // TODO: Make this configurable

  private val asTransaction: ResponseAs[Transaction, Any] =
    asByteArray.getRight.map(bytes => txSerializable.deserialize(bytes))

  // https://github.com/input-output-hk/midnight-ledger-prototype/blob/9e69c01f3bf02284fcdc0e92674e3f43d8ed895a/proof-server/src/lib.rs#L90
  // Padding for missing data for `/prove-tx` payload.
  private val paddingForMissingPayloadData = Array[Byte](0, 0, 0, 0, 0)

  def proveTransaction(tx: UnprovenTransaction): IO[Transaction] = {
    val serializedTx = tx.serialize
    val body = serializedTx ++ paddingForMissingPayloadData

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
  def apply[
      UnprovenTransaction: zswap.UnprovenTransaction.IsSerializable,
      Transaction: zswap.Transaction.IsSerializable,
  ](serverUri: Uri)(using
      zswap.NetworkId,
  ): Resource[IO, ProverClient[UnprovenTransaction, Transaction]] =
    SttpBackendFactory.build.map(
      new ProverClient[UnprovenTransaction, Transaction](serverUri, _),
    )
}
