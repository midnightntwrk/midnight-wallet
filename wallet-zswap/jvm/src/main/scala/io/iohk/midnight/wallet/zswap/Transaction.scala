package io.iohk.midnight.wallet.zswap

opaque type Transaction = Array[Byte]

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object Transaction {
  def deserialize(bytes: Array[Byte]): Transaction = bytes

  extension (tx: Transaction) {
    def serialize: Array[Byte] = tx
    def hash: String = ???
    def identifiers: Array[String] = ???
    def fees: BigInt = ???
    @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
    def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] = ???
    def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] = ???
    def guaranteedCoins: Offer = ???
    def fallibleCoins: Option[Offer] = ???
    def wellFormedNoProofs(enforceBalancing: Boolean): Unit = ???
    def merge(other: Transaction): Transaction = ???
    def eraseProofs: ProofErasedTransaction = ???
  }
}
