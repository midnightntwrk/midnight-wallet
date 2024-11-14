package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.std.Map as JsMap
import scala.scalajs.js

object Transaction {

  trait Transaction[T, Offer] {
    extension (t: T) {
      def hash: String
      def identifiers: Array[String]
      def fees: BigInt
      def guaranteedCoins: Option[Offer]
      def fallibleCoins: Option[Offer]
      def merge(other: T): T
    }
  }

  trait HasImbalances[T, TokenType] {
    extension (t: T) {
      def deltas: Map[TokenType, BigInt]
      def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt]
      def imbalances(guaranteed: Boolean): Map[TokenType, BigInt]
    }
  }

  trait IsSerializable[T] {
    def deserialize(bytes: Array[Byte])(using networkId: NetworkId): T
    extension (t: T) {
      def serialize(using networkId: NetworkId): String
    }
  }

  trait CanEraseProofs[T, ProofErasedTransaction] {
    extension (t: T) {
      def wellFormedNoProofs(enforceBalancing: Boolean): Unit
      def eraseProofs: ProofErasedTransaction
    }
  }

  @SuppressWarnings(Array("org.wartremover.warts.ToString"))
  given Transaction[mod.Transaction, mod.Offer] with {
    private val dummyLedgerParameters =
      mod.LedgerParameters.dummyParameters()

    extension (value: mod.Transaction) {
      override def hash: String =
        value.transactionHash()

      override def identifiers: Array[String] =
        value.identifiers().toArray

      override def fees: BigInt =
        BigInt(value.fees(dummyLedgerParameters).toString)

      override def guaranteedCoins: Option[mod.Offer] =
        value.guaranteedCoins.toOption

      override def fallibleCoins: Option[mod.Offer] =
        value.fallibleCoins.toOption

      def merge(other: mod.Transaction): mod.Transaction =
        value.merge(other)
    }
  }

  given HasImbalances[mod.Transaction, mod.TokenType] with {
    extension (value: mod.Transaction) {
      override def deltas: Map[mod.TokenType, BigInt] =
        value.imbalances(true).toMap.map(_.map(_.toScalaBigInt))

      @SuppressWarnings(Array("org.wartremover.warts.ToString"))
      def imbalances(guaranteed: Boolean, fees: BigInt): Map[mod.TokenType, BigInt] =
        toScalaStd(value.imbalances(guaranteed, js.BigInt(fees.toString)))

      def imbalances(guaranteed: Boolean): Map[mod.TokenType, BigInt] =
        toScalaStd(value.imbalances(guaranteed))

      private def toScalaStd(x: JsMap[mod.TokenType, js.BigInt]): Map[mod.TokenType, BigInt] =
        x.toMap.map(_.map(_.toScalaBigInt))
    }
  }

  given IsSerializable[mod.Transaction] with {
    override def deserialize(bytes: Array[Byte])(using networkId: NetworkId): mod.Transaction =
      mod.Transaction.deserialize(bytes.toUInt8Array, networkId.toJs)

    extension (value: mod.Transaction) {
      def serialize(using networkId: NetworkId): String =
        HexUtil.encodeHex(value.serialize(networkId.toJs).toByteArray)
    }
  }

  given CanEraseProofs[mod.Transaction, mod.ProofErasedTransaction] with {
    extension (value: mod.Transaction) {
      override def eraseProofs: mod.ProofErasedTransaction =
        value.eraseProofs()

      // FIXME: Use real ledger method for well formed transactions
      def wellFormedNoProofs(enforceBalancing: Boolean): Unit = ()
    }
  }
}
