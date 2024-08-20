package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.std.Map as JsMap
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import scala.scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.Overloading"))
final case class Transaction(value: mod.Transaction) {
  def serialize(using networkId: NetworkId): String =
    HexUtil.encodeHex(value.serialize(networkId.toJs).toByteArray)

  lazy val toJs: mod.Transaction = value

  lazy val hash: String =
    value.transactionHash()

  lazy val identifiers: Array[String] =
    value.identifiers().toArray

  lazy val deltas: Map[TokenType, BigInt] =
    value.imbalances(true).toMap.map(_.map(_.toScalaBigInt))

  lazy val fees: BigInt =
    BigInt(value.fees(Transaction.DummyLedgerParameters).toString)

  def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] =
    toScalaStd(value.imbalances(guaranteed, js.BigInt(fees.toString)))

  def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] =
    toScalaStd(value.imbalances(guaranteed))

  private def toScalaStd(x: JsMap[TokenType, js.BigInt]): Map[TokenType, BigInt] =
    x.toMap.map(_.map(_.toScalaBigInt))

  lazy val guaranteedCoins: Option[Offer] =
    value.guaranteedCoins.toOption.map(Offer.fromJs)

  lazy val fallibleCoins: Option[Offer] =
    value.fallibleCoins.toOption.map(Offer.fromJs)

  // FIXME: Use real ledger method for well formed transactions
  def wellFormedNoProofs(enforceBalancing: Boolean): Unit = ()

  def merge(other: Transaction): Transaction =
    Transaction(value.merge(other.value))

  lazy val eraseProofs: ProofErasedTransaction =
    ProofErasedTransaction.fromJs(value.eraseProofs())
}

object Transaction {
  private val DummyLedgerParameters = mod.LedgerParameters.dummyParameters()

  def deserialize(
      bytes: Array[Byte],
  )(using version: ProtocolVersion, networkId: NetworkId): Transaction =
    version match {
      case ProtocolVersion.V1 =>
        Transaction(mod.Transaction.deserialize(bytes.toUInt8Array, networkId.toJs))
    }

  def fromJs(tx: mod.Transaction): Transaction =
    Transaction(tx)
}
