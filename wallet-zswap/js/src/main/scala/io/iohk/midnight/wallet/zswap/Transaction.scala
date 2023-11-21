package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.std.Map as JsMap
import scala.scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.Overloading"))
final case class Transaction(value: mod.Transaction) {
  lazy val serialize: String =
    HexUtil.encodeHex(value.serialize().toByteArray)

  lazy val toJs: mod.Transaction = value

  lazy val hash: String =
    value.transactionHash()

  lazy val identifiers: Array[String] =
    value.identifiers().toArray

  lazy val deltas: Map[TokenType, BigInt] =
    value.imbalances(true).toMap.map(_.map(_.toScalaBigInt))

  lazy val fees: BigInt =
    BigInt(value.fees().toString)

  def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] =
    toScalaStd(value.imbalances(guaranteed, js.BigInt(fees.toString)))

  def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] =
    toScalaStd(value.imbalances(guaranteed))

  private def toScalaStd(x: JsMap[TokenType, js.BigInt]): Map[TokenType, BigInt] =
    x.toMap.map(_.map(_.toScalaBigInt))

  lazy val guaranteedCoins: Offer =
    Offer.fromJs(value.guaranteedCoins)

  lazy val fallibleCoins: Option[Offer] =
    value.fallibleCoins.toOption.map(Offer.fromJs)

  def wellFormedNoProofs(enforceBalancing: Boolean): Unit =
    value.eraseProofs().wellFormed(enforceBalancing)

  def merge(other: Transaction): Transaction =
    Transaction(value.merge(other.value))

  lazy val eraseProofs: ProofErasedTransaction =
    ProofErasedTransaction.fromJs(value.eraseProofs())
}

object Transaction {
  def deserialize(bytes: Array[Byte]): Transaction =
    Transaction(mod.Transaction.deserialize(bytes.toUInt8Array))

  def fromJs(tx: mod.Transaction): Transaction =
    Transaction(tx)
}
