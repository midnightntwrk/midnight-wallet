package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.std.Map as JsMap
import scala.scalajs.js

opaque type Transaction = mod.Transaction

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.Overloading"))
object Transaction {
  def deserialize(bytes: Array[Byte]): Transaction =
    mod.Transaction.deserialize(bytes.toUInt8Array)

  def fromJs(tx: mod.Transaction): Transaction = tx

  extension (tx: Transaction) {
    def serialize: String = HexUtil.encodeHex(tx.serialize().toByteArray)

    def toJs: mod.Transaction = tx

    def hash: String = tx.transactionHash()
    def identifiers: Array[String] = tx.identifiers().toArray

    def deltas: Map[TokenType, BigInt] =
      tx.imbalances(true).toMap.map(_.map(_.toScalaBigInt))

    def fees: BigInt = BigInt(tx.fees().toString())

    def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] =
      toScalaStd(tx.imbalances(guaranteed, js.BigInt(fees.toString())))

    def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] =
      toScalaStd(tx.imbalances(guaranteed))

    private def toScalaStd(x: JsMap[TokenType, js.BigInt]): Map[TokenType, BigInt] =
      x.toMap.map(_.map(_.toScalaBigInt))

    def guaranteedCoins: Offer = Offer.fromJs(tx.guaranteedCoins)

    def fallibleCoins: Option[Offer] = tx.fallibleCoins.toOption.map(Offer.fromJs)

    def wellFormedNoProofs(enforceBalancing: Boolean): Unit =
      tx.eraseProofs().wellFormed(enforceBalancing)

    def merge(other: Transaction): Transaction = tx.merge(other)

    def eraseProofs: ProofErasedTransaction = ProofErasedTransaction.fromJs(tx.eraseProofs())
  }
}
