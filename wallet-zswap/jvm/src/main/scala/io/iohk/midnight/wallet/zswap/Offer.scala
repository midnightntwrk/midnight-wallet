package io.iohk.midnight.wallet.zswap

opaque type Offer = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object Offer {
  def deserialize(bytes: Array[Byte]): Offer = ???

  extension (offer: Offer) {
    def deltas: Map[TokenType, BigInt] = ???
    def outputsSize: Int = ???
  }
}
