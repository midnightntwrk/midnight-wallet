package io.iohk.midnight.wallet.core.combinator

import cats.effect.{Concurrent, Ref}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.domain.IndexerUpdate

class VersionCombinator[F[_]: Concurrent](currentCombination: Ref[F, VersionCombination[F]]) {
  def sync: F[Unit] =
    Stream
      .repeatEval(currentCombination.get)
      .evalTap(internalSync(_).compile.drain)
      .evalMap(migrate)
      .evalMap(currentCombination.set)
      .compile
      .drain

  private def internalSync(versionCombination: VersionCombination[F]): Stream[F, IndexerUpdate] =
    versionCombination.updatesStream
      .takeWhile(versionCombination.predicate)
      .evalTap(versionCombination.updateState)

  private def migrate(versionCombination: VersionCombination[F]): F[VersionCombination[F]] =
    versionCombination match {
      case _: V1Combination[F] => Exception("No hard fork planned").raiseError
    }

  def state: Stream[F, State] =
    Stream.force(currentCombination.get.map(_.state))

  def serializeState: F[SerializedWalletState] =
    currentCombination.get.flatMap(_.serializeState)
}
