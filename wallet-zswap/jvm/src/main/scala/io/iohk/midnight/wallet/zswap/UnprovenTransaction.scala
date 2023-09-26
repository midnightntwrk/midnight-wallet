package io.iohk.midnight.wallet.zswap

opaque type UnprovenTransaction = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object UnprovenTransaction {
  @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
  def apply(guaranteedOffer: UnprovenOffer, fallibleOffer: UnprovenOffer): UnprovenTransaction = ???
  def apply(guaranteedOffer: UnprovenOffer): UnprovenTransaction = ???

  extension (unprovenTx: UnprovenTransaction) {
    def serialize: Array[Byte] = ???
    def eraseProofs: ProofErasedTransaction = ???
    def guaranteedCoins: UnprovenOffer = ???
  }
}
