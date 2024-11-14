package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import scala.scalajs.js

trait UnprovenOffer[T, UnprovenInput, UnprovenOutput, TokenType] {
  def fromInput(input: UnprovenInput, tokenType: TokenType, value: BigInt): T
  def fromOutput(output: UnprovenOutput, tokenType: TokenType, value: BigInt): T

  extension (t: T) {
    def serialize(using networkId: NetworkId): Array[Byte]
    def merge(other: T): T
    def inputs: Array[UnprovenInput]
    def outputs: Array[UnprovenOutput]
    def deltas: Map[TokenType, BigInt]
  }
}

given UnprovenOffer[
  mod.UnprovenOffer,
  mod.UnprovenInput,
  mod.UnprovenOutput,
  mod.TokenType,
] with {
  override def fromInput(
      input: mod.UnprovenInput,
      tokenType: mod.TokenType,
      value: BigInt,
  ): mod.UnprovenOffer =
    mod.UnprovenOffer.fromInput(input, tokenType, value.toJsBigInt)

  override def fromOutput(
      output: mod.UnprovenOutput,
      tokenType: mod.TokenType,
      value: BigInt,
  ): mod.UnprovenOffer =
    mod.UnprovenOffer.fromOutput(output, tokenType, value.toJsBigInt)

  extension (unprovenOffer: mod.UnprovenOffer) {
    override def serialize(using networkId: NetworkId): Array[Byte] =
      unprovenOffer.serialize(networkId.toJs).toByteArray

    override def merge(other: mod.UnprovenOffer): mod.UnprovenOffer =
      unprovenOffer.merge(other)

    override def inputs: Array[mod.UnprovenInput] =
      unprovenOffer.inputs.toArray

    override def outputs: Array[mod.UnprovenOutput] =
      unprovenOffer.outputs.toArray

    override def deltas: Map[mod.TokenType, BigInt] =
      unprovenOffer.deltas.toMap.map((token, delta) => (token, delta.toScalaBigInt))
  }
}

trait UnprovenInput[T, Nullifier] {
  extension (unprovenInput: T) {
    def nullifier: Nullifier
  }
}
given UnprovenInput[mod.UnprovenInput, mod.Nullifier] with {
  extension (unprovenInput: mod.UnprovenInput) {
    override def nullifier: mod.Nullifier = unprovenInput.nullifier
  }
}

trait UnprovenOutput[T, CoinInfo, CoinPublicKey, EncryptionPublicKey] {
  def create(coin: CoinInfo, publicKey: CoinPublicKey): T

  def create(
      coin: CoinInfo,
      coinPubKey: CoinPublicKey,
      encPubKey: EncryptionPublicKey,
  ): T
}

given UnprovenOutput[
  mod.UnprovenOutput,
  mod.CoinInfo,
  mod.CoinPublicKey,
  mod.EncPublicKey,
] with {
  override def create(coin: mod.CoinInfo, publicKey: mod.CoinPublicKey): mod.UnprovenOutput =
    mod.UnprovenOutput.`new`(coin, publicKey)

  override def create(
      coin: mod.CoinInfo,
      coinPubKey: mod.CoinPublicKey,
      encPubKey: mod.EncPublicKey,
  ): mod.UnprovenOutput =
    mod.UnprovenOutput.`new`(coin, coinPubKey, encPubKey)
}
