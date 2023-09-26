package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightZswap.mod
import io.iohk.midnight.js.interop.util.BigIntOps.*

opaque type MerkleTreeCollapsedUpdate = mod.MerkleTreeCollapsedUpdate

object MerkleTreeCollapsedUpdate {
  def apply(state: ZswapChainState, start: BigInt, end: BigInt): MerkleTreeCollapsedUpdate =
    mod.MerkleTreeCollapsedUpdate(state.toJs, start.toJsBigInt, end.toJsBigInt)

  extension (update: MerkleTreeCollapsedUpdate) {
    private[zswap] def toJs: mod.MerkleTreeCollapsedUpdate = update
  }
}
