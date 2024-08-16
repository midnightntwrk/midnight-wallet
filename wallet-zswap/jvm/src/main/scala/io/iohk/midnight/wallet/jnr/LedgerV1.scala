package io.iohk.midnight.wallet.jnr

import scala.util.{Failure, Success, Try}

trait LedgerV1 extends LedgerCommon

object LedgerV1 {
  def instanceWithNetworkId(networkId: NetworkId): Try[LedgerV1] =
    LedgerLoader.loadLedger(Some(networkId), ProtocolVersion.V1).flatMap {
      case v1: LedgerV1 => Success(v1)
      case v2: LedgerV2 => Failure(IllegalStateException())
    }
}
