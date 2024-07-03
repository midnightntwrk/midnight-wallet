package io.iohk.midnight.wallet.engine

import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.capabilities.WalletSync
import io.iohk.midnight.wallet.core.domain.IndexerUpdate
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.tracing.WalletSyncTracer
import io.iohk.midnight.wallet.core.{BlockProcessingFactory, WalletError, WalletStateContainer}

trait WalletSyncService[F[_]] {
  def updates: Stream[F, Either[WalletError, IndexerUpdate]]
  def stop: F[Unit]
}

object WalletSyncService {
  class Live[F[_]: Async, TWallet](
      syncServiceResource: Resource[F, SyncService[F]],
      walletStateContainer: WalletStateContainer[F, TWallet],
      deferred: Deferred[F, Either[Throwable, Unit]],
      offset: Option[Transaction.Offset],
  )(implicit
      walletSync: WalletSync[TWallet, IndexerUpdate],
      tracer: WalletSyncTracer[F],
  ) extends WalletSyncService[F] {

    override val updates: Stream[F, Either[WalletError, IndexerUpdate]] =
      Stream
        .resource(syncServiceResource)
        .flatMap { syncService =>
          syncService
            .sync(offset)
            .through(BlockProcessingFactory.pipe(walletStateContainer))
            .map(_.map { case (viewingUpdate, _) => viewingUpdate })
        }
        .interruptWhen(deferred)

    override val stop: F[Unit] =
      deferred.complete(Right(())).void
  }

  def apply[F[_]: Async, TWallet](
      syncService: Resource[F, SyncService[F]],
      walletStateContainer: WalletStateContainer[F, TWallet],
      offset: Option[Transaction.Offset],
  )(implicit
      walletSync: WalletSync[TWallet, IndexerUpdate],
      tracer: WalletSyncTracer[F],
  ): Resource[F, WalletSyncService[F]] = {
    val deferred = Resource.eval(Deferred[F, Either[Throwable, Unit]])
    val walletSyncService =
      deferred.map(new Live[F, TWallet](syncService, walletStateContainer, _, offset))
    walletSyncService.map(_.pure).flatMap(Resource.make(_)(_.stop))
  }
}
