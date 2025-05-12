package io.iohk.midnight.wallet.prover

import cats.effect.{IO, Resource}
import io.iohk.midnight.wallet.zswap
import sttp.client3.{
  ResponseAs,
  SttpBackend,
  SttpClientException,
  UriContext,
  asByteArray,
  emptyRequest,
}
import sttp.model.Uri
import io.iohk.midnight.wallet.prover.tracing.ProverClientTracer
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog

import scala.concurrent.duration.DurationInt

class ProverClient[UnprovenTransaction, Transaction](
    serverUri: Uri,
    backend: SttpBackend[IO, Any],
)(using
    txSerializable: zswap.Transaction.IsSerializable[Transaction],
)(using
    zswap.UnprovenTransaction.IsSerializable[UnprovenTransaction],
    zswap.NetworkId,
)(using tracer: ProverClientTracer) {
  private val readTimeout = 20.minutes // TODO: Make this configurable

  private val asTransaction: ResponseAs[Transaction, Any] =
    asByteArray.getRight.map(bytes => txSerializable.deserialize(bytes))

  // https://github.com/midnightntwrk/midnight-ledger/blob/9e69c01f3bf02284fcdc0e92674e3f43d8ed895a/proof-server/src/lib.rs#L90
  // Padding for missing data for `/prove-tx` payload.
  private val paddingForMissingPayloadData = Array[Byte](0, 0, 0, 0)

  def proveTransaction(tx: UnprovenTransaction): IO[Transaction] = {
    def sendRequest(tries: Int): IO[Transaction] = {
      val serializedTx = tx.serialize
      val body = serializedTx ++ paddingForMissingPayloadData

      val request = emptyRequest
        .body(body)
        .post(uri"$serverUri/prove-tx")
        .response(asTransaction)
        .readTimeout(readTimeout)

      backend
        .send(request)
        .map(_.body)
        .handleErrorWith { error =>
          val errorMessage =
            s"Error: ${error.getMessage}. Cause: ${Option(error.getCause).map(_.getMessage).getOrElse("Unknown cause")}"

          val randomDelay = (5 + scala.util.Random.nextInt(5)).seconds
          if (tries > 0) {
            IO.delay(
              tracer.provingFailed(
                s"Got an error: \"$errorMessage\". Retrying in $randomDelay. Tries remaining: ${tries - 1}",
              ),
            ) *> IO.sleep(randomDelay) *> sendRequest(tries - 1)
          } else IO.raiseError(adjustExceptionMessage(error))
        }
    }

    sendRequest(3)
  }

  private def adjustExceptionMessage(error: Throwable): Exception = {
    val message = error match {
      case e: sttp.client3.SttpClientException.ReadException
          if Option(e.cause.getMessage)
            .exists(_.contains("Unsupported version")) =>
        "Failed to prove transaction due to incorrect proof server version"
      case _ => "Failed to prove transaction"
    }

    new Exception(message, error)
  }
}

object ProverClient {
  def apply[
      UnprovenTransaction: zswap.UnprovenTransaction.IsSerializable,
      Transaction: zswap.Transaction.IsSerializable,
  ](serverUri: Uri)(using
      zswap.NetworkId,
  )(using
      rootTracer: Tracer[IO, StructuredLog],
  ): Resource[IO, ProverClient[UnprovenTransaction, Transaction]] = {
    given ProverClientTracer = ProverClientTracer.from(rootTracer)
    SttpBackendFactory.build.map(
      new ProverClient[UnprovenTransaction, Transaction](serverUri, _),
    )
  }
}
