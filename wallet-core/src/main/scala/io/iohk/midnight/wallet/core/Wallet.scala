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
  def applyState(state: LocalState): Wallet[LocalState, SecretKeys, Transaction] = {
    this.copy(state = state)
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
}

@JSExportTopLevel("CoreWallet")
@JSExportAll
object Wallet {
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
      new TWallet(
        snapshot.state,
        secretKeys.fromSeed(seed),
        snapshot.txHistory.toVector,
        snapshot.offset,
        ProgressUpdate(snapshot.offset.map(_.decrement), None, None, None),
        snapshot.protocolVersion,
        snapshot.networkId,
        isConnected = false,
      )
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

  given serializeState: WalletStateSerialize[TWallet, SerializedWalletState] =
    import snapshotInstances.given
    (wallet: TWallet) =>
      SerializedWalletState(
        Snapshot(
          wallet.state,
          wallet.txHistory,
          wallet.offset,
          wallet.protocolVersion,
          wallet.networkId,
        ).serialize,
      )

  given walletSync(using
      txHistory: WalletTxHistory[TWallet, Transaction],
  ): WalletSync[TWallet, IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]] =
    new DefaultSyncCapability
}
