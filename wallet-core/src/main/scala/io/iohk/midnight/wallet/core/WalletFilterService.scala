package io.iohk.midnight.wallet.core

import fs2.{RaiseThrowable, Stream}
import io.iohk.midnight.wallet.core.services.SyncService
import typings.midnightLedger.mod.Transaction

trait WalletFilterService[F[_]] {
  def installTransactionFilter(filter: Transaction => Boolean): Stream[F, Transaction]
}

object WalletFilterService {
  class Live[F[_]: RaiseThrowable](syncService: SyncService[F]) extends WalletFilterService[F] {
    override def installTransactionFilter(
        filter: Transaction => Boolean,
    ): Stream[F, Transaction] =
      syncService
        .sync()
        .map(_.body.transactionResults)
        .flatMap(Stream.emits)
        .map(LedgerSerialization.fromTransaction)
        .flatMap(Stream.fromEither(_))
        .filter(filter)
  }
}
