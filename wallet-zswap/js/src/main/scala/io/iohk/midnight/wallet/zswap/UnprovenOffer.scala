package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import scala.scalajs.js

opaque type UnprovenOffer = mod.UnprovenOffer
object UnprovenOffer {
  def fromJs(offer: mod.UnprovenOffer): UnprovenOffer = offer

  def fromInput(input: UnprovenInput, tokenType: TokenType, value: BigInt): UnprovenOffer =
    mod.UnprovenOffer.fromInput(input, tokenType, value.toJsBigInt)

  def fromOutput(output: UnprovenOutput, tokenType: TokenType, value: BigInt): UnprovenOffer =
    mod.UnprovenOffer.fromOutput(output, tokenType, value.toJsBigInt)

  extension (unprovenOffer: UnprovenOffer) {
    private[zswap] def toJs: mod.UnprovenOffer = unprovenOffer

    def serialize: Array[Byte] = unprovenOffer.serialize().toByteArray
    def merge(other: UnprovenOffer): UnprovenOffer = unprovenOffer.merge(other)
    def inputs: Array[UnprovenInput] = unprovenOffer.inputs.toArray
    def outputs: Array[UnprovenOutput] = unprovenOffer.outputs.toArray
    def deltas: Map[TokenType, BigInt] =
      unprovenOffer.deltas.toMap.map((token, delta) => (token, delta.toScalaBigInt))
  }
}

opaque type UnprovenInput = mod.UnprovenInput
object UnprovenInput {
  private[zswap] def fromJs(unprovenInput: mod.UnprovenInput): UnprovenInput = unprovenInput

  extension (unprovenInput: UnprovenInput) {
    private[zswap] def toJs: mod.UnprovenInput = unprovenInput
  }
}

opaque type UnprovenOutput = mod.UnprovenOutput

@SuppressWarnings(Array("org.wartremover.warts.Overloading"))
object UnprovenOutput {
  def apply(coin: CoinInfo, publicKey: CoinPublicKey): UnprovenOutput =
    mod.UnprovenOutput.`new`(coin.toJs, publicKey)
  def apply(
      coin: CoinInfo,
      coinPubKey: CoinPublicKey,
      encPubKey: EncryptionPublicKey,
  ): UnprovenOutput =
    mod.UnprovenOutput.`new`(coin.toJs, coinPubKey, encPubKey)
}
