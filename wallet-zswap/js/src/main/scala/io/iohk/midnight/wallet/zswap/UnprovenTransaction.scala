package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod

opaque type UnprovenTransaction = mod.UnprovenTransaction

object UnprovenTransaction {
  def fromJs(tx: mod.UnprovenTransaction): UnprovenTransaction = tx

  def apply(guaranteedOffer: UnprovenOffer, fallibleOffer: UnprovenOffer): UnprovenTransaction =
    mod.UnprovenTransaction(guaranteedOffer.toJs, fallibleOffer.toJs)

  @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
  def apply(guaranteedOffer: UnprovenOffer): UnprovenTransaction =
    mod.UnprovenTransaction(guaranteedOffer.toJs)

  extension (unprovenTx: UnprovenTransaction) {
    def serialize: Array[Byte] = unprovenTx.serialize().toByteArray
    def toJs: mod.UnprovenTransaction = unprovenTx
    def identifiers: Array[String] = unprovenTx.identifiers().toArray
    def eraseProofs: ProofErasedTransaction =
      ProofErasedTransaction.fromJs(unprovenTx.eraseProofs())
    def guaranteedCoins: UnprovenOffer =
      UnprovenOffer.fromJs(unprovenTx.guaranteedCoins)
  }
}
