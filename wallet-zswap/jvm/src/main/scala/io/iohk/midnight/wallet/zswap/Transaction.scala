package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerLoader.AllLedgers
import io.iohk.midnight.wallet.jnr.StringResult

final case class Transaction(data: String, allLedgers: AllLedgers) {
  def serialize: String = data

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def guaranteedCoins: Option[Offer] = {
    allLedgers.extractGuaranteedCoinsFromTransaction(data) match {
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
      case Right(StringResult(data)) =>
        Option.when(data.nonEmpty)(Offer.deserialize(data, allLedgers))
    }
  }

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def fallibleCoins: Option[Offer] = {
    allLedgers.extractFallibleCoinsFromTransaction(data) match {
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
      case Right(maybeFallibleCoinsData) =>
        maybeFallibleCoinsData.map(Offer.deserialize(_, allLedgers))
    }
  }
}

object Transaction {
  def deserialize(data: String, allLedgers: AllLedgers): Transaction =
    Transaction(data, allLedgers)

  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  def deserialize(bytes: Array[Byte], allLedgers: AllLedgers): Transaction =
    deserialize(HexUtil.encodeHex(bytes), allLedgers)
}
