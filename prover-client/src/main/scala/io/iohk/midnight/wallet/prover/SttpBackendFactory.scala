package io.iohk.midnight.wallet.prover

import cats.effect.IO
import cats.effect.kernel.Resource
import cats.syntax.applicative.*
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend

object SttpBackendFactory {
  def build: Resource[IO, SttpBackend[IO, Any]] =
    Resource.make(FetchCatsBackend[IO]().pure[IO])(_.close())
}
