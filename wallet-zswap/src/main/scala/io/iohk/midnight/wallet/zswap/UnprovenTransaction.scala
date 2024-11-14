package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod

object UnprovenTransaction {
  trait IsSerializable[T] {
    extension (t: T) {
      def identifiers: Array[String]
      def serialize(using networkId: NetworkId): Array[Byte]
    }
  }

  trait HasCoins[T, UnprovenOffer] {
    def create(guaranteedOffer: UnprovenOffer, fallibleOffer: UnprovenOffer): T
    def create(guaranteedOffer: UnprovenOffer): T
    extension (t: T) {
      def guaranteedCoins: Option[UnprovenOffer]
    }
  }

  trait CanEraseProofs[T, ProofErasedTransaction] {
    extension (t: T) {
      def eraseProofs: ProofErasedTransaction
    }
  }

  given IsSerializable[mod.UnprovenTransaction] with {
    extension (unprovenTx: mod.UnprovenTransaction) {
      override def serialize(using networkId: NetworkId): Array[Byte] =
        unprovenTx.serialize(networkId.toJs).toByteArray
      override def identifiers: Array[String] =
        unprovenTx.identifiers().toArray
    }
  }

  given HasCoins[mod.UnprovenTransaction, mod.UnprovenOffer] with {
    override def create(
        guaranteedOffer: mod.UnprovenOffer,
        fallibleOffer: mod.UnprovenOffer,
    ): mod.UnprovenTransaction =
      mod.UnprovenTransaction(guaranteedOffer, fallibleOffer)

    @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
    override def create(guaranteedOffer: mod.UnprovenOffer): mod.UnprovenTransaction =
      mod.UnprovenTransaction(guaranteedOffer)

    extension (unprovenTx: mod.UnprovenTransaction) {
      override def guaranteedCoins: Option[mod.UnprovenOffer] =
        unprovenTx.guaranteedCoins.toOption
    }
  }

  given CanEraseProofs[mod.UnprovenTransaction, mod.ProofErasedTransaction] with {
    extension (unprovenTx: mod.UnprovenTransaction) {
      override def eraseProofs: mod.ProofErasedTransaction =
        unprovenTx.eraseProofs()
    }
  }
}
