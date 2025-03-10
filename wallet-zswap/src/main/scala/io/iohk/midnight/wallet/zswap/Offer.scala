package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1

trait Offer[T, TokenType] {
  def deserialize(bytes: Array[Byte])(using networkId: NetworkId): T
  extension (t: T) {
    def deltas: Map[TokenType, BigInt]
    def outputsSize: Int
    def inputsSize: Int
  }
}

given Offer[v1.Offer, v1.TokenType] with {
  override def deserialize(bytes: Array[Byte])(using networkId: NetworkId): v1.Offer =
    v1.Offer.deserialize(bytes.toUInt8Array, networkId.toJs)

  extension (offer: v1.Offer) {
    def deltas: Map[v1.TokenType, BigInt] =
      offer.deltas.toMap.map((tt, a) => (tt, a.toScalaBigInt))
    def outputsSize: Int = offer.outputs.size
    def inputsSize: Int = offer.inputs.size
  }
}
