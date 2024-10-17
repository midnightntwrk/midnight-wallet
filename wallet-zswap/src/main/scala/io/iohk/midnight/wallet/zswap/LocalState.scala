package io.iohk.midnight.wallet.zswap

import cats.syntax.functor.*
import cats.syntax.eq.*
import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.js.interop.util.SetOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion

opaque type LocalState = mod.LocalState

object LocalState {
  def deserialize(
      bytes: Array[Byte],
  )(using version: ProtocolVersion, networkId: NetworkId): LocalState =
    version match {
      case ProtocolVersion.V1 =>
        mod.LocalState.deserialize(bytes.toUInt8Array, networkId.toJs)
    }

  def fromSeed(seed: Array[Byte], version: ProtocolVersion): LocalState =
    version match {
      case ProtocolVersion.V1 =>
        mod.LocalState.fromSeed(seed.toUInt8Array)
    }

  def apply(): LocalState =
    new mod.LocalState()

  extension (localState: LocalState) {
    def serialize(using networkId: NetworkId): Array[Byte] =
      localState.serialize(networkId.toJs).toByteArray

    def coins: List[QualifiedCoinInfo] =
      localState.coins.toList.map(QualifiedCoinInfo.fromJs)
    def availableCoins: List[QualifiedCoinInfo] = {
      val pending = localState.pendingSpends.valuesList.map(QualifiedCoinInfo.fromJs)
      localState.coins.toList
        .filterNot(coin => pending.exists(_.nonce === coin.nonce))
        .map(QualifiedCoinInfo.fromJs)
    }
    def pendingOutputs: List[CoinInfo] =
      localState.pendingOutputs.valuesList.map(CoinInfo.fromJs)
    def coinPublicKey: CoinPublicKey =
      localState.coinPublicKey
    def encryptionSecretKey: EncryptionSecretKey =
      EncryptionSecretKey.fromJs(
        localState.yesIKnowTheSecurityImplicationsOfThis_encryptionSecretKey(),
      )
    def encryptionPublicKey: EncryptionPublicKey =
      localState.encryptionPublicKey
    def watchFor(coin: CoinInfo): LocalState =
      localState.watchFor(coin.toJs)
    def spend(coin: QualifiedCoinInfo): (LocalState, UnprovenInput) =
      localState.spend(coin.toJs).map(UnprovenInput.fromJs)
    @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
    def apply(offer: Offer): LocalState =
      localState.apply(offer.toJs)
    def applyProofErased(offer: ProofErasedOffer): LocalState =
      localState.applyProofErased(offer.toJs)
    def applyFailed(offer: Offer): LocalState =
      localState.applyFailed(offer.toJs)
    def applyFailedProofErased(offer: ProofErasedOffer): LocalState =
      localState.applyFailedProofErased(offer.toJs)
    def pendingOutputsSize: Int =
      localState.pendingOutputs.valuesList.size
    def applyCollapsedUpdate(update: MerkleTreeCollapsedUpdate): LocalState =
      localState.applyCollapsedUpdate(update.toJs)
  }
}
