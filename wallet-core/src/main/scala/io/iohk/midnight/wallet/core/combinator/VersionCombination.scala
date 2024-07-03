package io.iohk.midnight.wallet.core.combinator

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.core.{Wallet, WalletStateContainer, WalletStateService}
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.domain.IndexerUpdate
import io.iohk.midnight.wallet.core.services.SyncService

sealed trait VersionCombination[F[_]] {
  def state: Stream[F, State]

  def serializeState: F[SerializedWalletState]

  def updatesStream: Stream[F, IndexerUpdate]

  def updateState(update: IndexerUpdate): F[Unit]

  def predicate(update: IndexerUpdate): Boolean
}

final class V1Combination[F[_]: Async](
    initialState: Wallet.Snapshot,
    syncService: Resource[F, SyncService[F]],
    stateContainer: WalletStateContainer[F, Wallet],
    stateService: WalletStateService[F, Wallet],
) extends VersionCombination[F] {
  override def updatesStream: Stream[F, IndexerUpdate] =
    Stream.resource(syncService).flatMap(_.sync(initialState.offset))

  override def updateState(update: IndexerUpdate): F[Unit] =
    stateContainer.updateStateEither(_.apply(update)).rethrow.void

  override def state: Stream[F, WalletStateService.State] =
    stateService.state

  override def serializeState: F[WalletStateService.SerializedWalletState] =
    stateService.serializeState

  override def predicate(update: IndexerUpdate): Boolean =
    update.protocolVersion === ProtocolVersion.V1
}
