package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerV1
import io.iohk.midnight.wallet.jnr.StringResult

opaque type MerkleTreeCollapsedUpdate = String

object MerkleTreeCollapsedUpdate {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def apply(
      zswapChainState: ZswapChainState,
      startIndex: BigInt,
      endIndex: BigInt,
      ledger: LedgerV1,
  ): MerkleTreeCollapsedUpdate =
    ledger.merkleTreeCollapsedUpdateNew(
      zswapChainState.state,
      startIndex.longValue,
      endIndex.longValue,
    ) match {
      case Right(StringResult(data)) => data
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    }

  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  def apply(
      zswapChainState: ZswapChainState,
      startIndex: BigInt,
      endIndex: BigInt,
  ): MerkleTreeCollapsedUpdate =
    apply(zswapChainState, startIndex, endIndex, LedgerV1.instance.get)

  extension (update: MerkleTreeCollapsedUpdate) {
    def serialize: String = update
  }
}
