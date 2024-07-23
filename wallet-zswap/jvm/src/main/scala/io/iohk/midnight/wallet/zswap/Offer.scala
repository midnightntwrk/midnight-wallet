package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerV1

final case class Offer(data: String, ledger: LedgerV1)

object Offer {
  def deserialize(data: String, ledger: LedgerV1): Offer = Offer(data, ledger)
}
