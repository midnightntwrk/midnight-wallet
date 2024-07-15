package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.Ledger
import io.iohk.midnight.wallet.jnr.Ledger.StringResult

final case class Transaction(data: String, ledger: Ledger) {
  def serialize: String = data

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def guaranteedCoins: Offer =
    ledger.extractGuaranteedCoinsFromTransaction(data) match {
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
      case Right(StringResult(data)) => Offer.deserialize(data, ledger)
    }

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def fallibleCoins: Option[Offer] = ledger.extractFallibleCoinsFromTransaction(data) match {
    case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    case Right(maybeFallibleCoinsData) => maybeFallibleCoinsData.map(Offer.deserialize(_, ledger))
  }
}

object Transaction {
  def deserialize(data: String, ledger: Ledger): Transaction = Transaction(data, ledger)
  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  def deserialize(bytes: Array[Byte]): Transaction =
    deserialize(HexUtil.encodeHex(bytes), Ledger.instance.get)
}
