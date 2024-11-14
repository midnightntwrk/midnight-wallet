package io.iohk.midnight.wallet.core.combinator

import cats.MonadThrow
import cats.syntax.all.*

trait CombinationMigrations[F[_]] {
  def migrate(versionCombination: VersionCombination[F]): F[VersionCombination[F]]
}

object CombinationMigrations {
  def default[F[_]: MonadThrow]: CombinationMigrations[F] =
    new CombinationMigrations[F] {
      override def migrate(versionCombination: VersionCombination[F]): F[VersionCombination[F]] = {
        versionCombination match
          case _: V1Combination[F] =>
            Exception("No hard fork planned").raiseError
      }
    }

}
