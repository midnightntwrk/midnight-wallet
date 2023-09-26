package io.iohk.midnight.wallet.prover

import cats.effect.{Async, Resource}
import sttp.client3.SttpBackend
import sttp.client3.httpclient.cats.HttpClientCatsBackend

object SttpBackendFactory {
  def build[F[_]: Async]: Resource[F, SttpBackend[F, Any]] =
    HttpClientCatsBackend.resource()
}
