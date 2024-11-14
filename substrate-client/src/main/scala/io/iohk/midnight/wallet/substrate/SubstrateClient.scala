package io.iohk.midnight.wallet.substrate

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.zswap
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.client3.{ResponseAs, SttpBackend, emptyRequest}
import sttp.model.Uri
import sttp.client3.circe.*

class SubstrateClient[F[_]: Async, Transaction: zswap.Transaction.IsSerializable](
    substrateUri: Uri,
    backend: SttpBackend[F, Any],
) {
  private val serialization = JsonSerialization[Transaction]
  import serialization.given

  def submitTransaction(
      req: SubmitTransactionRequest[Transaction],
  ): F[SubmitTransactionResponse] = {
    val request = emptyRequest
      .body(req)
      .post(substrateUri)
      .response(asJson[SubmitTransactionResponse].getRight)

    backend.send(request).map(_.body).adaptError { case error =>
      Exception(s"There was an error submitting the transaction: ${error.getMessage}", error)
    }
  }

}

object SubstrateClient {
  def apply[F[_]: Async, Transaction: zswap.Transaction.IsSerializable](
      serverUri: Uri,
  ): Resource[F, SubstrateClient[F, Transaction]] = {
    val backend = FetchCatsBackend()
    Resource.make(backend.pure)(_.close()).map(new SubstrateClient(serverUri, _))
  }
}
