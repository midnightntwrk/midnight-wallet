package io.iohk.midnight.wallet.zswap

opaque type ProofErasedTransaction = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object ProofErasedTransaction {
  extension (tx: ProofErasedTransaction) {
    def guaranteedCoins: ProofErasedOffer = ???
    def merge(other: ProofErasedTransaction): ProofErasedTransaction = ???
    def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] = ???
    @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
    def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] = ???
    def fees: BigInt = ???
  }
}
