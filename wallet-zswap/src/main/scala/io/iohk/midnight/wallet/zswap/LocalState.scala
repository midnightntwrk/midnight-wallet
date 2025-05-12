package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import cats.syntax.eq.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.js.interop.util.SetOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.wallet.zswap.UnprovenOutput.Segment

import scala.scalajs.js.annotation.JSExportTopLevel

object LocalState {
  trait HasCoins[T, SecretKeys, QualifiedCoinInfo, CoinInfo, UnprovenInput] {
    extension (t: T) {
      def coins: List[QualifiedCoinInfo]
      def availableCoins: List[QualifiedCoinInfo]
      def pendingOutputs: List[CoinInfo]
      def pendingOutputsSize: Int
      def watchFor(secretKeys: SecretKeys, coin: CoinInfo): T
      def spend(
          segment: Segment,
          secretKeys: SecretKeys,
          coin: QualifiedCoinInfo,
      ): (T, UnprovenInput)
    }
  }
  trait EvolveState[T, SecretKeys, Offer, ProofErasedOffer, MerkleTreeCollapsedUpdate] {
    extension (t: T) {
      def apply(secretKeys: SecretKeys, offer: Offer): T
      def applyProofErased(secretKeys: SecretKeys, offer: ProofErasedOffer): T
      def applyFailed(offer: Offer): T
      def applyFailedProofErased(offer: ProofErasedOffer): T
      def applyCollapsedUpdate(update: MerkleTreeCollapsedUpdate): T
    }
  }
  trait IsSerializable[T] {
    def deserialize(bytes: Array[Byte])(using NetworkId): T
    def create(): T

    extension (t: T) {
      def serialize(using NetworkId): Array[Byte]
    }
  }

  given HasCoins[
    v1.LocalState,
    v1.SecretKeys,
    v1.QualifiedCoinInfo,
    v1.CoinInfo,
    v1.UnprovenInput,
  ] with {
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
      override def watchFor(secretKeys: v1.SecretKeys, coin: v1.CoinInfo): v1.LocalState =
        localState.watchFor(secretKeys.coinPublicKey, coin)
      override def spend(
          segment: Segment,
          secretKeys: v1.SecretKeys,
          coin: v1.QualifiedCoinInfo,
      ): (v1.LocalState, v1.UnprovenInput) =
        localState.spend(secretKeys, coin, segment.value)
    }
  }

  @JSExportTopLevel("V1EvolveState")
  given EvolveState[
    v1.LocalState,
    v1.SecretKeys,
    v1.Offer,
    v1.ProofErasedOffer,
    v1.MerkleTreeCollapsedUpdate,
  ] with {
    extension (localState: v1.LocalState) {
      override def apply(secretKeys: v1.SecretKeys, offer: v1.Offer): v1.LocalState =
        localState.apply(secretKeys, offer)
      override def applyProofErased(
          secretKeys: v1.SecretKeys,
          offer: v1.ProofErasedOffer,
      ): v1.LocalState =
        localState.applyProofErased(secretKeys, offer)
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
    override def create(): v1.LocalState =
      new v1.LocalState()
    extension (localState: v1.LocalState) {
      override def serialize(using networkId: NetworkId): Array[Byte] =
        localState.serialize(networkId.toJs).toByteArray
    }
  }
}
