package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.Ledger
import io.iohk.midnight.wallet.jnr.Ledger.StringResult

opaque type MerkleTreeCollapsedUpdate = String

object MerkleTreeCollapsedUpdate {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def apply(
      zswapChainState: ZswapChainState,
      startIndex: BigInt,
      endIndex: BigInt,
      ledger: Ledger,
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
    apply(zswapChainState, startIndex, endIndex, Ledger.instance.get)

  extension (update: MerkleTreeCollapsedUpdate) {
    def serialize: String = update
  }
}
