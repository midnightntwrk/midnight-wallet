package io.iohk.midnight.wallet.util

import cats.Functor
import cats.effect.Clock
import cats.syntax.functor.*
import java.time.Instant

object ClockOps {
  implicit class ClockExtensions[F[_]: Functor](c: Clock[F]) {
    def realTimeInstant: F[Instant] =
      c.realTime.map(_.toMillis).map(Instant.ofEpochMilli)
  }
}
