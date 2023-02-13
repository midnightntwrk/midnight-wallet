package io.iohk.midnight.wallet.core

import cats.effect.kernel.Sync
import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.midnightLedger.mod.Transaction
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.tracing.WalletFilterTracer

trait WalletFilterService[F[_]] {
  def installTransactionFilter(filter: Transaction => Boolean): Stream[F, Transaction]
}

object WalletFilterService {
  object Live {
    def apply[F[_]: Async](
        syncService: SyncService[F],
    )(implicit
        tracer: WalletFilterTracer[F],
    ): Resource[F, Live[F]] = {
      Resource
        .eval(Deferred[F, Either[Throwable, Unit]])
        .map(new Live[F](syncService, _))
        .map(_.pure)
        .flatMap(Resource.make(_)(_.stop))
    }
  }

  class Live[F[_]: Sync](
      syncService: SyncService[F],
      deferred: Deferred[F, Either[Throwable, Unit]],
  )(implicit
      tracer: WalletFilterTracer[F],
  ) extends WalletFilterService[F] {
    override def installTransactionFilter(
        filter: Transaction => Boolean,
    ): Stream[F, Transaction] =
      syncService
        .sync()
        .interruptWhen(deferred)
        .map(_.body.transactionResults)
        .flatMap(Stream.emits)
        .map(LedgerSerialization.fromTransaction)
        .flatMap(Stream.fromEither(_))
        .evalFilter { tx =>
          Sync[F]
            .delay(filter(tx))
            .flatTap(res => tracer.txFilterApplied(tx, filterMatched = res))
        }
    private val stop: F[Unit] =
      deferred.complete(Right(())).void
  }
}
