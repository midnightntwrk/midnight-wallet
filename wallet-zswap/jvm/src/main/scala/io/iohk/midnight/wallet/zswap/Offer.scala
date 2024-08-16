package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerLoader.AllLedgers

final case class Offer(data: String, allLedgers: AllLedgers)

object Offer {
  def deserialize(data: String, allLedgers: AllLedgers): Offer = Offer(data, allLedgers)
}
