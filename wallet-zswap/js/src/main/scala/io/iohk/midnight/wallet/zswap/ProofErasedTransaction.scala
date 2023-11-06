package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*

opaque type ProofErasedTransaction = mod.ProofErasedTransaction

object ProofErasedTransaction {
  def fromJs(tx: mod.ProofErasedTransaction): ProofErasedTransaction = tx

  extension (tx: ProofErasedTransaction) {
    private[zswap] def toJs: mod.ProofErasedTransaction = tx

    def guaranteedCoins: ProofErasedOffer = ProofErasedOffer.fromJs(tx.guaranteedCoins)

    def merge(other: ProofErasedTransaction): ProofErasedTransaction = tx.merge(other)

    def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt] =
      tx.imbalances(guaranteed, fees.toJsBigInt)
        .toMap
        .map((tt, a) => (TokenType(tt), a.toScalaBigInt))

    @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
    def imbalances(guaranteed: Boolean): Map[TokenType, BigInt] =
      tx.imbalances(guaranteed).toMap.map((tt, a) => (TokenType(tt), a.toScalaBigInt))

    def fees: BigInt = tx.fees().toScalaBigInt
  }
}
