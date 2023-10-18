package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightZswap.mod
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import scala.util.Try

opaque type MerkleTreeCollapsedUpdate = mod.MerkleTreeCollapsedUpdate

object MerkleTreeCollapsedUpdate {
  def apply(state: ZswapChainState, start: BigInt, end: BigInt): MerkleTreeCollapsedUpdate =
    mod.MerkleTreeCollapsedUpdate(state.toJs, start.toJsBigInt, end.toJsBigInt)

  def deserialize(bytes: Array[Byte]): Try[MerkleTreeCollapsedUpdate] =
    Try { mod.MerkleTreeCollapsedUpdate.deserialize(bytes.toUInt8Array) }

  extension (update: MerkleTreeCollapsedUpdate) {
    private[zswap] def toJs: mod.MerkleTreeCollapsedUpdate = update
  }
}
