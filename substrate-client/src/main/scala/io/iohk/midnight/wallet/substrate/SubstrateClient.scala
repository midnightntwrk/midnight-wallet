package io.iohk.midnight.wallet.substrate

import cats.effect.{Async, Resource}
import cats.syntax.applicative.*
import cats.syntax.functor.*
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.client3.{ResponseAs, SttpBackend, emptyRequest}
import sttp.model.Uri
import sttp.client3.circe.*
import JsonSerialization.given

class SubstrateClient[F[_]: Async](substrateUri: Uri, backend: SttpBackend[F, Any]) {

  def submitTransaction(req: SubmitTransactionRequest): F[SubmitTransactionResponse] = {

    val request = emptyRequest
      .body(req)
      .post(substrateUri)
      .response(asJson[SubmitTransactionResponse].getRight)

    backend.send(request).map(_.body)
  }

}

object SubstrateClient {
  def apply[F[_]: Async](serverUri: Uri): Resource[F, SubstrateClient[F]] = {
    val backend = FetchCatsBackend()
    Resource.make(backend.pure)(_.close()).map(new SubstrateClient[F](serverUri, _))
  }
}
