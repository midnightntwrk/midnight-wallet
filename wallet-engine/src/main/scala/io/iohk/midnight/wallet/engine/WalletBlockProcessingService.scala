package io.iohk.midnight.wallet.engine

import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.capabilities.WalletBlockProcessing
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.tracing.WalletBlockProcessingTracer
import io.iohk.midnight.wallet.core.{BlockProcessingFactory, WalletStateContainer}

trait WalletBlockProcessingService[F[_]] {
  def start: F[Unit]
  def stop: F[Unit]
}

object WalletBlockProcessingService {
  class Live[F[_]: Async, TWallet](
      syncService: SyncService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
      deferred: Deferred[F, Either[Throwable, Unit]],
  )(implicit
      walletBlockProcessing: WalletBlockProcessing[TWallet, Block],
      tracer: WalletBlockProcessingTracer[F],
  ) extends WalletBlockProcessingService[F] {

    override val start: F[Unit] =
      BlockProcessingFactory
        .pipe(walletStateContainer)
        .apply(syncService.sync())
        .interruptWhen(deferred)
        .compile
        .drain

    override val stop: F[Unit] =
      deferred.complete(Right(())).void
  }

  def apply[F[_]: Async, TWallet](
      syncService: SyncService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      walletBlockProcessing: WalletBlockProcessing[TWallet, Block],
      tracer: WalletBlockProcessingTracer[F],
  ): Resource[F, WalletBlockProcessingService[F]] = {
    val deferred = Resource.eval(Deferred[F, Either[Throwable, Unit]])
    val walletBlockProcessingService =
      deferred.map(new Live[F, TWallet](syncService, walletStateContainer, _))
    walletBlockProcessingService.map(_.pure).flatMap(Resource.make(_)(_.stop))
  }
}
