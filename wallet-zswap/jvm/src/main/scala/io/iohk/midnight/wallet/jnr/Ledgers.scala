package io.iohk.midnight.wallet.jnr

import scala.util.Try

final case class Ledgers(
    ledgerV1: LedgerV1,
    ledgerV2: LedgerV2,
)

object Ledgers {
  def ledgersWithNetworkId(networkId: NetworkId): Try[Ledgers] = {
    for {
      ledgerV1 <- LedgerV1.instanceWithNetworkId(networkId)
      ledgerV2 <- LedgerV2.instanceWithNetworkId(networkId)
    } yield Ledgers(ledgerV1, ledgerV2)
  }
}
