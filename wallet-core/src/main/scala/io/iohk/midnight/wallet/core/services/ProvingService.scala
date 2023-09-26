package io.iohk.midnight.wallet.core.services

import io.iohk.midnight.wallet.zswap.{Offer, Transaction, UnprovenOffer, UnprovenTransaction}

trait ProvingService[F[_]] {
  def proveTransaction(tx: UnprovenTransaction): F[Transaction]
  def proveOffer(offer: UnprovenOffer): F[Offer]
}
