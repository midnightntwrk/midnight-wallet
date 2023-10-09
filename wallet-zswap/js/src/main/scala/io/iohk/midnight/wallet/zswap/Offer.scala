package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightZswap.mod

opaque type Offer = mod.Offer

object Offer {
  def deserialize(bytes: Array[Byte]): Offer =
    mod.Offer.deserialize(bytes.toUInt8Array)

  def fromJs(offer: mod.Offer): Offer = offer

  extension (offer: Offer) {
    private[zswap] def toJs: mod.Offer = offer

    def serialize: Array[Byte] = offer.serialize().toByteArray

    def deltas: Map[TokenType, BigInt] =
      offer.deltas.toMap.map((tt, a) => (TokenType(tt), a.toScalaBigInt))

    def inputsSize: Int = offer.inputs.size
    def outputsSize: Int = offer.outputs.size
  }
}
