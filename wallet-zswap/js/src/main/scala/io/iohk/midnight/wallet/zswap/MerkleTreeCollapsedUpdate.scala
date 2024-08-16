package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.wallet.blockchain
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import scala.util.Try

opaque type MerkleTreeCollapsedUpdate = mod.MerkleTreeCollapsedUpdate

object MerkleTreeCollapsedUpdate {
  def apply(
      state: ZswapChainState,
      start: BigInt,
      end: BigInt,
      protocolVersion: ProtocolVersion,
  ): MerkleTreeCollapsedUpdate =
    protocolVersion match {
      case blockchain.data.ProtocolVersion.V1 =>
        mod.MerkleTreeCollapsedUpdate(state.toJs, start.toJsBigInt, end.toJsBigInt)
    }

  def deserialize(
      bytes: Array[Byte],
      protocolVersion: ProtocolVersion,
  ): Try[MerkleTreeCollapsedUpdate] =
    protocolVersion match {
      case data.ProtocolVersion.V1 =>
        Try { mod.MerkleTreeCollapsedUpdate.deserialize(bytes.toUInt8Array) }
    }

  extension (update: MerkleTreeCollapsedUpdate) {
    private[zswap] def toJs: mod.MerkleTreeCollapsedUpdate = update
  }
}
