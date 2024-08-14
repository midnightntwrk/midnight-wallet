package io.iohk.midnight.wallet.core.combinator

import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}

class VersionCombinator[F[_]: Async](
    currentCombination: Bloc[F, VersionCombination[F]],
    combinationMigrations: CombinationMigrations[F],
    deferred: Deferred[F, Unit],
) {
  def sync: F[Unit] =
    currentCombination.subscribe
      .interruptWhen(deferred.get.attempt)
      .evalTap(_.sync)
      .evalMap(migrate)
      .evalMap(currentCombination.set)
      .compile
      .drain

  private def migrate(versionCombination: VersionCombination[F]): F[VersionCombination[F]] =
    combinationMigrations.migrate(versionCombination)

  def state: Stream[F, State] =
    currentCombination.subscribe.flatMap(_.state)

  def serializeState: F[SerializedWalletState] =
    currentCombination.subscribe.head.compile.lastOrError.flatMap(_.serializeState)
}

object VersionCombinator {
  def apply[F[_]: Async](
      currentCombination: VersionCombination[F],
  ): Resource[F, VersionCombinator[F]] =
    for {
      bloc <- Bloc[F, VersionCombination[F]](currentCombination)
      deferred <- Resource.make(Deferred[F, Unit])(_.complete(()).void)
    } yield new VersionCombinator(bloc, CombinationMigrations.default, deferred)
}
