package io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.jnr.Ledger

final case class Offer(data: String, ledger: Ledger)

object Offer {
  def deserialize(data: String, ledger: Ledger): Offer = Offer(data, ledger)
}
