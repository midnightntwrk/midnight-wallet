package io.iohk.midnight.wallet.core

import cats.effect.kernel.Sync
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.midnightLedger.mod.Transaction
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.tracing.WalletFilterTracer

trait WalletFilterService[F[_]] {
  def installTransactionFilter(filter: Transaction => Boolean): Stream[F, Transaction]
}

object WalletFilterService {
  class Live[F[_]: Sync](syncService: SyncService[F])(implicit
      tracer: WalletFilterTracer[F],
  ) extends WalletFilterService[F] {
    override def installTransactionFilter(
        filter: Transaction => Boolean,
    ): Stream[F, Transaction] =
      syncService
        .sync()
        .map(_.body.transactionResults)
        .flatMap(Stream.emits)
        .map(LedgerSerialization.fromTransaction)
        .flatMap(Stream.fromEither(_))
        .evalFilter { tx =>
          Sync[F]
            .delay(filter(tx))
            .flatTap(res => tracer.txFilterApplied(tx, filterMatched = res))
        }
  }
}
