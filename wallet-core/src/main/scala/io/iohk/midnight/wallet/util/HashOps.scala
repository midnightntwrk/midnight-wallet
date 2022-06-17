package io.iohk.midnight.wallet.util

import cats.Functor
import cats.syntax.functor.*
import cats.effect.std.Random
import io.iohk.midnight.wallet.domain.{Hash, Hashing}

object HashOps {
  implicit def hashable[F[_]: Functor: Random]: Hashing[F] =
    new Hashing[F] {
      override def calculateHash[T](t: T): F[Hash[T]] =
        Random[F]
          .nextBytes(32)
          .map(new java.math.BigInteger(_))
          .map(_.abs())
          .map(String.format("%064x", _))
          .map(Hash[T])
    }
}
