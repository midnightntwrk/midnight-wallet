package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod.LedgerParameters

trait ProofErasedTransaction[T, LedgerParameters, ProofErasedOffer, TokenType] {
  def dummyLedgerParameters: LedgerParameters

  extension (t: T) {
    def guaranteedCoins: Option[ProofErasedOffer]
    def fallibleCoins: Option[ProofErasedOffer]
    def merge(other: T): T
    def imbalances(guaranteed: Boolean, fees: BigInt): Map[TokenType, BigInt]
    def imbalances(guaranteed: Boolean): Map[TokenType, BigInt]
    def fees: BigInt
  }
}

given ProofErasedTransaction[
  v1.ProofErasedTransaction,
  v1.LedgerParameters,
  v1.ProofErasedOffer,
  v1.TokenType,
] with {
  override lazy val dummyLedgerParameters: v1.LedgerParameters =
    v1.LedgerParameters.dummyParameters()

  extension (tx: v1.ProofErasedTransaction) {
    override def guaranteedCoins: Option[v1.ProofErasedOffer] =
      tx.guaranteedCoins.toOption

    override def fallibleCoins: Option[v1.ProofErasedOffer] =
      tx.fallibleCoins.toOption

    override def merge(other: v1.ProofErasedTransaction): v1.ProofErasedTransaction =
      tx.merge(other)

    override def imbalances(guaranteed: Boolean, fees: BigInt): Map[v1.TokenType, BigInt] =
      tx.imbalances(guaranteed, fees.toJsBigInt)
        .toMap
        .map((tt, a) => (tt, a.toScalaBigInt))

    override def imbalances(guaranteed: Boolean): Map[v1.TokenType, BigInt] =
      tx.imbalances(guaranteed).toMap.map((tt, a) => (tt, a.toScalaBigInt))

    override def fees: BigInt = tx.fees(dummyLedgerParameters).toScalaBigInt
  }
}
