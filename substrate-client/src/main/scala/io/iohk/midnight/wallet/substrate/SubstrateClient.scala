package io.iohk.midnight.wallet.substrate

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.zswap
import sttp.client3.circe.*
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.client3.{SttpBackend, emptyRequest}
import sttp.model.Uri

class SubstrateClient[Transaction: zswap.Transaction.IsSerializable](
    substrateUri: Uri,
    backend: SttpBackend[IO, Any],
) {
  private val serialization = JsonSerialization[Transaction]
  import serialization.given

  def submitTransaction(
      req: SubmitTransactionRequest[Transaction],
  ): IO[SubmitTransactionResponse] = {
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
  def apply[Transaction: zswap.Transaction.IsSerializable](
      serverUri: Uri,
  ): Resource[IO, SubstrateClient[Transaction]] = {
    val backend = FetchCatsBackend[IO]()
    Resource.make(backend.pure[IO])(_.close()).map(new SubstrateClient(serverUri, _))
  }
}
