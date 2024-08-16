package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerLoader.AllLedgers
import io.iohk.midnight.wallet.jnr.StringResult

opaque type MerkleTreeCollapsedUpdate = String

object MerkleTreeCollapsedUpdate {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def apply(
      zswapChainState: ZswapChainState,
      startIndex: BigInt,
      endIndex: BigInt,
      allLedgers: AllLedgers,
  ): MerkleTreeCollapsedUpdate =
    allLedgers.merkleTreeCollapsedUpdateNew(
      zswapChainState.state,
      startIndex.longValue,
      endIndex.longValue,
    ) match {
      case Right(StringResult(data)) => data
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    }

  extension (update: MerkleTreeCollapsedUpdate) {
    def serialize: String = update
  }
}
