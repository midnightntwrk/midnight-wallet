package io.iohk.midnight.wallet.engine

import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.BlockProcessingFactory.AppliedTransaction
import io.iohk.midnight.wallet.core.capabilities.WalletTransactionProcessing
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.tracing.WalletTransactionProcessingTracer
import io.iohk.midnight.wallet.core.{BlockProcessingFactory, WalletError, WalletStateContainer}

trait WalletTransactionProcessingService[F[_]] {
  def transactions: Stream[F, Either[WalletError, AppliedTransaction]]
  def stop: F[Unit]
}

object WalletTransactionProcessingService {
  class Live[F[_]: Async, TWallet](
      syncService: SyncService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
      deferred: Deferred[F, Either[Throwable, Unit]],
  )(implicit
      walletTransactionProcessing: WalletTransactionProcessing[TWallet, Transaction],
      tracer: WalletTransactionProcessingTracer[F],
  ) extends WalletTransactionProcessingService[F] {

    override val transactions: Stream[F, Either[WalletError, AppliedTransaction]] =
      BlockProcessingFactory
        .pipe(walletStateContainer)
        .apply(syncService.sync())
        .map(_.map { case (appliedTx, _) =>
          appliedTx
        })
        .interruptWhen(deferred)

    override val stop: F[Unit] =
      deferred.complete(Right(())).void
  }

  def apply[F[_]: Async, TWallet](
      syncService: SyncService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      walletTransactionProcessing: WalletTransactionProcessing[TWallet, Transaction],
      tracer: WalletTransactionProcessingTracer[F],
  ): Resource[F, WalletTransactionProcessingService[F]] = {
    val deferred = Resource.eval(Deferred[F, Either[Throwable, Unit]])
    val walletTransactionProcessingService =
      deferred.map(new Live[F, TWallet](syncService, walletStateContainer, _))
    walletTransactionProcessingService.map(_.pure).flatMap(Resource.make(_)(_.stop))
  }
}
