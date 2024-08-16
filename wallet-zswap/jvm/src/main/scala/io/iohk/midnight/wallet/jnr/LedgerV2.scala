package io.iohk.midnight.wallet.jnr

import scala.util.{Failure, Success, Try}

trait LedgerV2 extends LedgerCommon

object LedgerV2 {
  def instanceWithNetworkId(networkId: NetworkId): Try[LedgerV2] =
    // TODO Change version to V2 once we will have c-bindings for v2.
    LedgerLoader.loadLedger(Some(networkId), ProtocolVersion.V1).flatMap {
      case v2: LedgerV2 => Success(v2)
      case v1: LedgerV1 => Failure(IllegalStateException())
    }
}
