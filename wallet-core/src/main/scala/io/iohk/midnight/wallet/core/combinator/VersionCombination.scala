package io.iohk.midnight.wallet.core.combinator

import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.core.{Wallet, WalletStateContainer, WalletStateService}
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.domain.IndexerUpdate
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.zswap.Transaction

trait VersionCombination[F[_]] {
  def sync: F[Unit]

  def state: Stream[F, State]

  def serializeState: F[SerializedWalletState]
}

final class V1Combination[F[_]: Async](
    initialState: Wallet.Snapshot,
    syncService: Resource[F, SyncService[F]],
    stateContainer: WalletStateContainer[F, Wallet],
    stateService: WalletStateService[F, Wallet],
    deferred: Deferred[F, Unit],
)(using WalletTxHistory[Wallet, Transaction])
    extends VersionCombination[F] {
  override def sync: F[Unit] =
    updatesStream.takeWhile(predicate).evalMap(updateState).compile.drain

  private def updatesStream: Stream[F, IndexerUpdate] =
    Stream
      .resource(syncService)
      .interruptWhen(deferred.get.attempt)
      .flatMap(_.sync(initialState.offset))

  private def updateState(update: IndexerUpdate): F[Unit] =
    stateContainer.updateStateEither(_.apply(update)).rethrow.void

  private def predicate(update: IndexerUpdate): Boolean =
    update.protocolVersion === ProtocolVersion.V1

  override def state: Stream[F, WalletStateService.State] =
    stateService.state

  override def serializeState: F[WalletStateService.SerializedWalletState] =
    stateService.serializeState

  private val stop: F[Unit] =
    deferred.complete(()).void
}

object V1Combination {
  def apply[F[_]: Async](
      initialState: Wallet.Snapshot,
      syncService: Resource[F, SyncService[F]],
      stateContainer: WalletStateContainer[F, Wallet],
      stateService: WalletStateService[F, Wallet],
  )(using WalletTxHistory[Wallet, Transaction]): Resource[F, V1Combination[F]] =
    Resource.make(
      Deferred[F, Unit]
        .map(new V1Combination[F](initialState, syncService, stateContainer, stateService, _)),
    )(_.stop)
}
