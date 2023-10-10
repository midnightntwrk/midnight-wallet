package io.iohk.midnight.wallet.core.services

import io.iohk.midnight.wallet.zswap.{Transaction, UnprovenTransaction}

trait ProvingService[F[_]] {
  def proveTransaction(tx: UnprovenTransaction): F[Transaction]
}
