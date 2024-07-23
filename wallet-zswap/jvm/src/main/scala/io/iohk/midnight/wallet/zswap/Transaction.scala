package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerV1
import io.iohk.midnight.wallet.jnr.StringResult

final case class Transaction(data: String, ledger: LedgerV1) {
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
  def deserialize(data: String, ledger: LedgerV1): Transaction = Transaction(data, ledger)
  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  def deserialize(bytes: Array[Byte]): Transaction =
    deserialize(HexUtil.encodeHex(bytes), LedgerV1.instance.get)
}
