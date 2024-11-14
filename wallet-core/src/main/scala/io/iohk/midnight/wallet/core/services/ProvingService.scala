package io.iohk.midnight.wallet.core.services

trait ProvingService[F[_], UnprovenTransaction, Transaction] {
  def proveTransaction(tx: UnprovenTransaction): F[Transaction]
}
