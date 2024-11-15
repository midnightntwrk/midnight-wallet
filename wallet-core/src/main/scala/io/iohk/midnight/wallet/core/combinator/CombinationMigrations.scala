package io.iohk.midnight.wallet.core.combinator

import cats.effect.IO
import cats.syntax.all.*

trait CombinationMigrations {
  def migrate(versionCombination: VersionCombination): IO[VersionCombination]
}

object CombinationMigrations {
  def default: CombinationMigrations =
    new CombinationMigrations {
      override def migrate(
          versionCombination: VersionCombination,
      ): IO[VersionCombination] = {
        versionCombination match
          case _: V1Combination =>
            Exception("No hard fork planned").raiseError
      }
    }

}
