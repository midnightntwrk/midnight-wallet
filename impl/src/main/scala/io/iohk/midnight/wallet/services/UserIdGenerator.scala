package io.iohk.midnight.wallet.services

import cats.Applicative
import cats.effect.std.Random
import cats.syntax.functor.*
import cats.syntax.traverse.*
import io.iohk.midnight.wallet.domain.UserId

object UserIdGenerator {
  def generate[F[_]: Applicative: Random](idLength: Int): F[UserId] =
    Seq
      .fill(idLength)(Random[F].nextAlphaNumeric)
      .sequence
      .map(_.mkString)
      .map(UserId.apply)
}
