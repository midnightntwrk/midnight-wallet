package io.iohk.midnight.wallet.core

import cats.Show
import cats.kernel.Eq
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.ProvingRecipe as ApiProvingRecipe
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion.V1
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.instances.*
import io.iohk.midnight.wallet.core.instances.DefaultBalancingCapability.Recipe
import io.iohk.midnight.wallet.core.parser.{Bech32Decoder, HexDecoder}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.UnprovenOutput.Segment
import io.iohk.midnight.js.interop.util.BigIntOps.*

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("CoreWalletInstance")
@JSExportAll
final case class Wallet[LocalState, SecretKeys, Transaction](
    state: LocalState,
    secretKeys: SecretKeys,
    txHistory: Vector[Transaction],
    offset: Option[data.Transaction.Offset],
    progress: ProgressUpdate,
    protocolVersion: ProtocolVersion,
    networkId: zswap.NetworkId,
    isConnected: Boolean,
) {
  lazy val txHistoryArray: js.Array[Transaction] = txHistory.toJSArray;

  def applyState(state: LocalState): Wallet[LocalState, SecretKeys, Transaction] = {
    this.copy(state = state)
  }

  def setOffset(newOffset: js.BigInt): Wallet[LocalState, SecretKeys, Transaction] = {
    this.copy(offset = Some(data.Transaction.Offset(newOffset.toScalaBigInt)))
  }

  def addTransaction(transaction: Transaction): Wallet[LocalState, SecretKeys, Transaction] = {
    this.copy(txHistory = txHistory :+ transaction)
  }

  def updateProgress(
      appliedIndex: js.UndefOr[js.BigInt],
      highestRelevantWalletIndex: js.UndefOr[js.BigInt],
      highestIndex: js.UndefOr[js.BigInt],
      highestRelevantIndex: js.UndefOr[js.BigInt],
  ): Wallet[LocalState, SecretKeys, Transaction] = {
    this.copy(
      progress = this.progress.copy(
        appliedIndex = appliedIndex.toOption.map(n => data.Transaction.Offset(n.toScalaBigInt)),
        highestRelevantWalletIndex =
          highestRelevantWalletIndex.toOption.map(n => data.Transaction.Offset(n.toScalaBigInt)),
        highestIndex = highestIndex.toOption.map(n => data.Transaction.Offset(n.toScalaBigInt)),
        highestRelevantIndex =
          highestRelevantIndex.toOption.map(n => data.Transaction.Offset(n.toScalaBigInt)),
      ),
    )
  }

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def update(
      appliedIndex: js.UndefOr[js.BigInt],
      offset: js.UndefOr[js.BigInt],
      protocolVersion: js.BigInt,
      isConnected: Boolean,
  ): Wallet[LocalState, SecretKeys, Transaction] = {
    val protocolVersionParsed = ProtocolVersion.fromBigInt(protocolVersion) match {
      case Right(version) => version
      case Left(error) => throw new Exception(s"Unknown protocol version: $protocolVersion", error)
    }

    val offsetParsed = offset.toOption.map(i => data.Transaction.Offset(i.toScalaBigInt))

    this.copy(
      progress = this.progress.copy(appliedIndex =
        appliedIndex.toOption.map(n => data.Transaction.Offset(n.toScalaBigInt)),
      ),
      offset = offsetParsed,
      protocolVersion = protocolVersionParsed,
      isConnected = isConnected,
    )
  }

  def updateTxHistory(
      newTxHistory: Vector[Transaction],
  ): Wallet[LocalState, SecretKeys, Transaction] = {
    this.copy(txHistory = newTxHistory)
  }

  def applyTransaction[
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
      TX: zswap.Transaction.Transaction[*, Offer],
  ](
      transaction: AppliedTransaction[TX],
  )(using
      evolveState: zswap.LocalState.EvolveState[
        LocalState,
        SecretKeys,
        Offer,
        ProofErasedOffer,
        MerkleTreeCollapsedUpdate,
      ],
  ): Wallet[LocalState, SecretKeys, Transaction] = {
    val tx = transaction.tx
    val newState = transaction.applyStage match {
      case ApplyStage.FailEntirely =>
        val guaranteed = tx.guaranteedCoins.fold(state)(state.applyFailed)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.FailFallible =>
        val guaranteed = tx.guaranteedCoins.fold(state)(state.apply(secretKeys, _))
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.SucceedEntirely =>
        val guaranteed = transaction.tx.guaranteedCoins.fold(state)(state.apply(secretKeys, _))
        tx.fallibleCoins.fold(guaranteed)(guaranteed.apply(secretKeys, _))
    }

    this.copy(state = newState)
  }

  def toSnapshot(): Snapshot[LocalState, Transaction] = {
    Snapshot(
      this.state,
      this.txHistory,
      this.offset,
      this.protocolVersion,
      this.networkId,
    )
  }
}

@JSExportTopLevel("CoreWallet")
@JSExportAll
object Wallet {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def restore(
      secretKeys: mod.SecretKeys,
      state: mod.LocalState,
      txHistory: js.Array[mod.Transaction],
      offset: js.UndefOr[js.BigInt],
      protocolVersion: js.BigInt,
      networkId: zswap.NetworkId,
  ): Wallet[mod.LocalState, mod.SecretKeys, mod.Transaction] = {
    val protocolVersionParsed = ProtocolVersion.fromBigInt(protocolVersion) match {
      case Right(version) => version
      case Left(error) => throw new Exception(s"Unknown protocol version: $protocolVersion", error)
    }

    val offsetParsed = offset.toOption.map(i => data.Transaction.Offset(i.toScalaBigInt))

    new Wallet(
      state,
      secretKeys,
      txHistory.toVector,
      offsetParsed,
      ProgressUpdate(offsetParsed.map(_.decrement), None, None, None),
      protocolVersionParsed,
      networkId,
      isConnected = false,
    )
  }

  def emptyV1(
      localState: mod.LocalState,
      secretKeys: mod.SecretKeys,
      networkId: zswap.NetworkId,
  ): Wallet[mod.LocalState, mod.SecretKeys, mod.Offer] = {
    new Wallet(
      localState,
      secretKeys,
      Vector.empty,
      None,
      ProgressUpdate.empty,
      V1,
      networkId,
      false,
    )
  }

  def fromSnapshot[LocalState, SecretKeys, Transaction](
      secretKeys: SecretKeys,
      snapshot: Snapshot[LocalState, Transaction],
  ): Wallet[LocalState, SecretKeys, Transaction] = {
    new Wallet(
      snapshot.state,
      secretKeys,
      snapshot.txHistory.toVector,
      snapshot.offset,
      ProgressUpdate(snapshot.offset.map(_.decrement), None, None, None),
      snapshot.protocolVersion,
      snapshot.networkId,
      isConnected = false,
    )
  }
}

class WalletInstances[
    LocalState,
    SecretKeys,
    Transaction,
    TokenType,
    Offer,
    ProofErasedTransaction,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    CoinPublicKey,
    EncryptionSecretKey,
    EncPublicKey,
    CoinSecretKey,
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
](using
    zswap.LocalState.HasCoins[
      LocalState,
      SecretKeys,
      QualifiedCoinInfo,
      CoinInfo,
      UnprovenInput,
    ],
    zswap.LocalState.EvolveState[
      LocalState,
      SecretKeys,
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
    ],
    zswap.SecretKeys.CanInit[SecretKeys],
    zswap.SecretKeys.HasCoinPublicKey[SecretKeys, CoinPublicKey],
    zswap.SecretKeys.HasEncryptionPublicKey[SecretKeys, EncPublicKey],
    zswap.SecretKeys.HasCoinSecretKey[SecretKeys, CoinSecretKey],
    zswap.SecretKeys.HasEncryptionSecretKey[SecretKeys, EncryptionSecretKey],
    zswap.Transaction.HasImbalances[Transaction, TokenType],
    zswap.Transaction.Transaction[Transaction, Offer],
    zswap.Offer[Offer, TokenType],
    zswap.QualifiedCoinInfo[QualifiedCoinInfo, TokenType, ?],
    zswap.UnprovenTransaction.CanEraseProofs[UnprovenTransaction, ProofErasedTransaction],
    zswap.UnprovenTransaction.CanMerge[UnprovenTransaction],
    zswap.ProofErasedTransaction[ProofErasedTransaction, ?, ProofErasedOffer, TokenType],
    zswap.TokenType[TokenType, ?],
    zswap.UnprovenInput[UnprovenInput, Nullifier],
    Eq[TokenType],
    Show[TokenType],
    HexDecoder[Address[CoinPublicKey, EncPublicKey]],
    Bech32Decoder[Address[CoinPublicKey, EncPublicKey]],
    Function1[Recipe[UnprovenTransaction, Transaction], ApiProvingRecipe],
)(using
    snapshotInstances: SnapshotInstances[LocalState, Transaction],
    secretKeys: zswap.SecretKeys.CanInit[SecretKeys],
    unprovenOffer: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    unprovenOutput: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPublicKey, EncPublicKey],
    unprovenTx: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    coinInfo: zswap.CoinInfo[CoinInfo, TokenType],
) {
  type TWallet = Wallet[LocalState, SecretKeys, Transaction]

  given getSk: Function1[TWallet, SecretKeys] = wallet => wallet.secretKeys

  given getState: Function1[TWallet, LocalState] = wallet => wallet.state

  given applyState: Function2[TWallet, LocalState, TWallet] = (wallet, newState) =>
    wallet.copy(state = newState)

  given applyTransaction: Function2[TWallet, AppliedTransaction[Transaction], TWallet] =
    (wallet, tx) => wallet.applyTransaction(tx)

  given getNetworkId: Function1[TWallet, zswap.NetworkId] = wallet => wallet.networkId

  given walletCreation: WalletCreation[TWallet, Snapshot[LocalState, Transaction]] =
    (seed: Array[Byte], snapshot: Snapshot[LocalState, Transaction]) => {
      Wallet.fromSnapshot(secretKeys.fromSeed(seed), snapshot)
    }

  given walletBalances: WalletBalances[TWallet, TokenType] with {
    extension (wallet: TWallet) {
      override def balance: Map[TokenType, BigInt] =
        wallet.state.availableCoins.groupMapReduce(_.tokenType)(_.value)(_ + _)
    }
  }

  given walletKeys: WalletKeys[TWallet, CoinPublicKey, EncPublicKey, EncryptionSecretKey] with {
    extension (wallet: TWallet) {
      override def coinPublicKey: CoinPublicKey =
        wallet.secretKeys.coinPublicKey
      override def encryptionPublicKey: EncPublicKey =
        wallet.secretKeys.encryptionPublicKey
      override def viewingKey: EncryptionSecretKey =
        wallet.secretKeys.encryptionSecretKey
    }
  }

  given walletCoins: WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier] =
    new DefaultCoinsCapability(
      getCoins = (wallet) => wallet.state.coins,
      getNullifiers = (wallet) =>
        wallet.state.coins.map(
          wallet.state.spend(Segment.Guaranteed, wallet.secretKeys, _)._2.nullifier,
        ),
      getAvailableCoins = wallet => wallet.state.availableCoins,
      getPendingCoins = wallet => wallet.state.pendingOutputs,
    )

  given walletTxBalancing
      : WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, CoinInfo] = {
    given balancer: TransactionBalancer[
      LocalState,
      TokenType,
      UnprovenTransaction,
      UnprovenOffer,
      UnprovenInput,
      UnprovenOutput,
      Transaction,
      Offer,
      QualifiedCoinInfo,
      CoinInfo,
    ] = TransactionBalancer[
      LocalState,
      TokenType,
      UnprovenTransaction,
      UnprovenOffer,
      UnprovenInput,
      UnprovenOutput,
      Transaction,
      Offer,
      QualifiedCoinInfo,
      CoinInfo,
    ]

    new DefaultBalancingCapability[
      TWallet,
      Transaction,
      UnprovenTransaction,
      LocalState,
      TokenType,
      UnprovenOffer,
      UnprovenInput,
      UnprovenOutput,
      Offer,
      QualifiedCoinInfo,
      CoinInfo,
      Nullifier,
      SecretKeys,
      CoinPublicKey,
      EncPublicKey,
    ]
  }

  given walletTxTransfer: WalletTxTransfer[
    TWallet,
    Transaction,
    UnprovenTransaction,
    TokenType,
    CoinPublicKey,
    EncPublicKey,
  ] = {
    new DefaultTransferCapability[
      TWallet,
      LocalState,
      SecretKeys,
      Transaction,
      TokenType,
      Offer,
      ProofErasedTransaction,
      CoinInfo,
      CoinPublicKey,
      EncPublicKey,
      UnprovenInput,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
      UnprovenTransaction,
      UnprovenOffer,
      UnprovenOutput,
    ]
  }

  val walletTxHistory: WalletTxHistory[TWallet, Transaction] = new DefaultTxHistoryCapability()

  val walletDiscardTxHistory: WalletTxHistory[TWallet, Transaction] =
    new DiscardTxHistoryCapability()

  given serializeState: WalletStateSerialize[TWallet, SecretKeys, SerializedWalletState] = {
    val default = new DefaultSerializeCapability[TWallet, SecretKeys, LocalState, Transaction](
      toSnapshot = (wallet) => wallet.toSnapshot(),
      fromSnapshot = (secretKeys, snapshot) => Wallet.fromSnapshot(secretKeys, snapshot),
    )

    new WalletStateSerialize[TWallet, SecretKeys, SerializedWalletState] {
      extension (wallet: TWallet)
        override def serialize: SerializedWalletState = SerializedWalletState(
          default.serialize(wallet),
        )

      override def deserialize(
          secretKeys: SecretKeys,
          serialized: SerializedWalletState,
      ): Either[WalletError, TWallet] =
        default.deserialize(secretKeys, serialized.serializedState)
    }
  }

  given walletSync(using
      txHistory: WalletTxHistory[TWallet, Transaction],
  ): WalletSync[TWallet, IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]] =
    new DefaultSyncCapability
}
