package io.iohk.midnight.wallet.core.services

import cats.effect.IO

trait ProvingService[UnprovenTransaction, Transaction] {
  def proveTransaction(tx: UnprovenTransaction): IO[Transaction]
}
