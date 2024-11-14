package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import scala.util.Try

trait MerkleTreeCollapsedUpdate[T, ZswapChainState] {
  def create(state: ZswapChainState, start: BigInt, end: BigInt): T
  def deserialize(bytes: Array[Byte])(using networkId: NetworkId): Try[T]
}

given MerkleTreeCollapsedUpdate[
  mod.MerkleTreeCollapsedUpdate,
  mod.ZswapChainState,
] with {
  override def create(
      state: mod.ZswapChainState,
      start: BigInt,
      end: BigInt,
  ): mod.MerkleTreeCollapsedUpdate =
    mod.MerkleTreeCollapsedUpdate(state, start.toJsBigInt, end.toJsBigInt)

  def deserialize(bytes: Array[Byte])(using
      networkId: NetworkId,
  ): Try[mod.MerkleTreeCollapsedUpdate] =
    Try { mod.MerkleTreeCollapsedUpdate.deserialize(bytes.toUInt8Array, networkId.toJs) }
}
