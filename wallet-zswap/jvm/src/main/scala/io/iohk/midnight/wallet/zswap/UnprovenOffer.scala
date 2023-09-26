package io.iohk.midnight.wallet.zswap

opaque type UnprovenOffer = Nothing
opaque type UnprovenInput = Nothing
opaque type UnprovenOutput = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object UnprovenOffer {
  def fromInput(input: UnprovenInput, tokenType: TokenType, value: BigInt): UnprovenOffer =
    ???

  def fromOutput(output: UnprovenOutput, tokenType: TokenType, value: BigInt): UnprovenOffer =
    ???

  extension (unprovenOffer: UnprovenOffer) {
    def serialize: Array[Byte] = ???
    def merge(other: UnprovenOffer): UnprovenOffer = ???
    def inputs: Array[UnprovenInput] = ???
    def outputs: Array[UnprovenOutput] = ???
    def deltas: Map[TokenType, BigInt] = ???
  }
}

@SuppressWarnings(
  Array("org.wartremover.warts.TripleQuestionMark", "org.wartremover.warts.Overloading"),
)
object UnprovenOutput {
  def apply(coin: CoinInfo, publicKey: CoinPublicKey): UnprovenOutput = ???
  def apply(
      coin: CoinInfo,
      publicKey: CoinPublicKey,
      targetEpk: EncryptionSecretKey,
  ): UnprovenOutput = ???
}
