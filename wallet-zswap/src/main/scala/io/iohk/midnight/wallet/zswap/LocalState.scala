package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import cats.syntax.eq.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.js.interop.util.SetOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1

import scala.scalajs.js.annotation.JSExportTopLevel

object LocalState {
  trait HasCoins[T, QualifiedCoinInfo, CoinInfo, UnprovenInput] {
    extension (t: T) {
      def coins: List[QualifiedCoinInfo]
      def availableCoins: List[QualifiedCoinInfo]
      def pendingOutputs: List[CoinInfo]
      def pendingOutputsSize: Int
      def watchFor(coin: CoinInfo): T
      def spend(coin: QualifiedCoinInfo): (T, UnprovenInput)
    }
  }
  trait HasKeys[T, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] {
    extension (t: T) {
      def coinPublicKey: CoinPublicKey
      def encryptionSecretKey: EncryptionSecretKey
      def encryptionPublicKey: EncryptionPublicKey
    }
  }
  trait EvolveState[T, Offer, ProofErasedOffer, MerkleTreeCollapsedUpdate] {
    extension (t: T) {
      def apply(offer: Offer): T
      def applyProofErased(offer: ProofErasedOffer): T
      def applyFailed(offer: Offer): T
      def applyFailedProofErased(offer: ProofErasedOffer): T
      def applyCollapsedUpdate(update: MerkleTreeCollapsedUpdate): T
    }
  }
  trait IsSerializable[T] {
    def deserialize(bytes: Array[Byte])(using NetworkId): T
    def fromSeed(seed: Array[Byte]): T
    def create(): T

    extension (t: T) {
      def serialize(using NetworkId): Array[Byte]
    }
  }

  given HasCoins[v1.LocalState, v1.QualifiedCoinInfo, v1.CoinInfo, v1.UnprovenInput] with {
    extension (localState: v1.LocalState) {
      override def coins: List[v1.QualifiedCoinInfo] =
        localState.coins.toList
      override def availableCoins: List[v1.QualifiedCoinInfo] = {
        val pending = localState.pendingSpends.valuesList
        localState.coins.toList
          .filterNot(coin => pending.exists(_.nonce === coin.nonce))
      }
      override def pendingOutputs: List[v1.CoinInfo] =
        localState.pendingOutputs.valuesList
      override def pendingOutputsSize: Int =
        localState.pendingOutputs.valuesList.size
      override def watchFor(coin: v1.CoinInfo): v1.LocalState =
        localState.watchFor(coin)
      override def spend(coin: v1.QualifiedCoinInfo): (v1.LocalState, v1.UnprovenInput) =
        localState.spend(coin)
    }
  }

  given HasKeys[v1.LocalState, v1.CoinPublicKey, v1.EncPublicKey, v1.EncryptionSecretKey] with {
    extension (localState: v1.LocalState) {
      override def coinPublicKey: v1.CoinPublicKey =
        localState.coinPublicKey

      override def encryptionSecretKey: v1.EncryptionSecretKey =
        localState.yesIKnowTheSecurityImplicationsOfThis_encryptionSecretKey()

      override def encryptionPublicKey: v1.EncPublicKey =
        localState.encryptionPublicKey
    }
  }

  @JSExportTopLevel("V1EvolveState")
  given EvolveState[v1.LocalState, v1.Offer, v1.ProofErasedOffer, v1.MerkleTreeCollapsedUpdate]
  with {
    extension (localState: v1.LocalState) {
      override def apply(offer: v1.Offer): v1.LocalState =
        localState.apply(offer)
      override def applyProofErased(offer: v1.ProofErasedOffer): v1.LocalState =
        localState.applyProofErased(offer)
      override def applyFailed(offer: v1.Offer): v1.LocalState =
        localState.applyFailed(offer)
      override def applyFailedProofErased(offer: v1.ProofErasedOffer): v1.LocalState =
        localState.applyFailedProofErased(offer)
      override def applyCollapsedUpdate(update: v1.MerkleTreeCollapsedUpdate): v1.LocalState =
        localState.applyCollapsedUpdate(update)
    }
  }

  given IsSerializable[v1.LocalState] with {
    override def deserialize(bytes: Array[Byte])(using networkId: NetworkId): v1.LocalState =
      v1.LocalState.deserialize(bytes.toUInt8Array, networkId.toJs)
    override def fromSeed(seed: Array[Byte]): v1.LocalState =
      v1.LocalState.fromSeed(seed.toUInt8Array)
    override def create(): v1.LocalState =
      new v1.LocalState()
    extension (localState: v1.LocalState) {
      override def serialize(using networkId: NetworkId): Array[Byte] =
        localState.serialize(networkId.toJs).toByteArray
    }
  }
}
