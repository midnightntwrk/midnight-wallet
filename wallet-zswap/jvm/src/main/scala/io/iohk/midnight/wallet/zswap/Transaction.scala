package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.Ledger
import io.iohk.midnight.wallet.jnr.Ledger.StringResult

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
final case class Transaction(bytes: Array[Byte], ledger: Ledger) {
  def serialize: Array[Byte] = bytes
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def guaranteedCoins: Offer =
    ledger.extractGuaranteedCoinsFromTransaction(HexUtil.encodeHex(bytes)) match {
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
      case Right(StringResult(data)) => Offer.deserialize(data, ledger)
    }

  def hash: String = ???
  def identifiers: Array[String] = ???
  def fees: BigInt = ???
  @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
  def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] = ???
  def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] = ???
  def fallibleCoins: Option[Offer] = ???
  def wellFormedNoProofs(enforceBalancing: Boolean): Unit = ???
  def merge(other: Transaction): Transaction = ???
  def eraseProofs: ProofErasedTransaction = ???
}

object Transaction {
  def deserialize(bytes: Array[Byte], ledger: Ledger): Transaction = Transaction(bytes, ledger)
  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  def deserialize(bytes: Array[Byte]): Transaction = deserialize(bytes, Ledger.instance.get)
}
