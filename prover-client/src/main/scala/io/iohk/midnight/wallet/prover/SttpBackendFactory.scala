package io.iohk.midnight.wallet.prover

import cats.effect.Async
import cats.effect.kernel.Resource
import cats.syntax.applicative.*
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend

object SttpBackendFactory {
  def build[F[_]: Async]: Resource[F, SttpBackend[F, Any]] =
    Resource.make(FetchCatsBackend().pure[F])(_.close())
}
