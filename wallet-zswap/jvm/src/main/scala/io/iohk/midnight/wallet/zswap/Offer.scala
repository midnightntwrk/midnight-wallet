package io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.jnr.Ledger

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
final case class Offer(data: String, ledger: Ledger) {
  def deltas: Map[TokenType, BigInt] = ???
  def outputsSize: Int = ???
}

object Offer {
  def deserialize(data: String, ledger: Ledger): Offer = Offer(data, ledger)
}
