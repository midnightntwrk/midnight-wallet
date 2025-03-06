package io.iohk.midnight.wallet.core

import cats.Show
import cats.kernel.Eq
import cats.syntax.all.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion.V1
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.instances.{
  DefaultSyncCapability,
  DefaultTxHistoryCapability,
  DiscardTxHistoryCapability,
}
import io.iohk.midnight.wallet.zswap

import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("CoreWalletInstance")
@JSExportAll
final case class Wallet[LocalStateNoKeys, SecretKeys, Transaction](
    state: LocalStateNoKeys,
    secretKeys: SecretKeys,
    txHistory: Vector[Transaction],
    offset: Option[data.Transaction.Offset],
    progress: ProgressUpdate,
    protocolVersion: ProtocolVersion,
    networkId: zswap.NetworkId,
    isConnected: Boolean,
) {
  def applyTransaction[
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
      TX: zswap.Transaction.Transaction[*, Offer],
  ](
      transaction: AppliedTransaction[TX],
  )(using
      evolveState: zswap.LocalStateNoKeys.EvolveState[
        LocalStateNoKeys,
        SecretKeys,
        Offer,
        ProofErasedOffer,
        MerkleTreeCollapsedUpdate,
      ],
  ): Wallet[LocalStateNoKeys, SecretKeys, Transaction] = {
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
      localState: mod.LocalStateNoKeys,
      secretKeys: mod.SecretKeys,
      networkId: zswap.NetworkId,
  ): Wallet[mod.LocalStateNoKeys, mod.SecretKeys, mod.Offer] = {
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
    LocalStateNoKeys,
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
    zswap.LocalStateNoKeys.HasCoins[
      LocalStateNoKeys,
      SecretKeys,
      QualifiedCoinInfo,
      CoinInfo,
      UnprovenInput,
    ],
    zswap.LocalStateNoKeys.EvolveState[
      LocalStateNoKeys,
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
    zswap.QualifiedCoinInfo[QualifiedCoinInfo, TokenType, ?],
    zswap.UnprovenTransaction.CanEraseProofs[UnprovenTransaction, ProofErasedTransaction],
    zswap.CoinPublicKey[CoinPublicKey],
    zswap.EncryptionPublicKey[EncPublicKey],
    zswap.ProofErasedTransaction[ProofErasedTransaction, ?, ProofErasedOffer, TokenType],
    zswap.TokenType[TokenType, ?],
    zswap.UnprovenInput[UnprovenInput, Nullifier],
    Eq[TokenType],
    Show[TokenType],
)(using
    snapshotInstances: SnapshotInstances[LocalStateNoKeys, Transaction],
    sks: zswap.SecretKeys.CanInit[SecretKeys],
    uo: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    uOut: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPublicKey, EncPublicKey],
    ut: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    ci: zswap.CoinInfo[CoinInfo, TokenType],
) {
  type TWallet = Wallet[LocalStateNoKeys, SecretKeys, Transaction]
  private val transactionBalancer = TransactionBalancer[
    TokenType,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenInput,
    UnprovenOutput,
    LocalStateNoKeys,
    SecretKeys,
    Transaction,
    Offer,
    QualifiedCoinInfo,
    CoinPublicKey,
    EncPublicKey,
    CoinInfo,
  ]

  given walletCreation: WalletCreation[TWallet, Snapshot[LocalStateNoKeys, Transaction]] =
    (seed: Array[Byte], snapshot: Snapshot[LocalStateNoKeys, Transaction]) => {
      new TWallet(
        snapshot.state,
        sks.fromSeed(seed),
        snapshot.txHistory.toVector,
        snapshot.offset,
        ProgressUpdate(snapshot.offset.map(_.decrement), none),
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

  given walletCoins: WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier] with {
    extension (wallet: TWallet) {
      override def coins: Seq[QualifiedCoinInfo] =
        wallet.state.coins
      override def nullifiers: Seq[Nullifier] =
        wallet.state.coins.map(wallet.state.spend(wallet.secretKeys, _)._2.nullifier)
      override def availableCoins: Seq[QualifiedCoinInfo] =
        wallet.state.availableCoins
      override def pendingCoins: Seq[CoinInfo] =
        wallet.state.pendingOutputs
    }
  }

  given walletTxBalancing
      : WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, CoinInfo, TokenType] with {
    extension (wallet: TWallet) {
      override def prepareTransferRecipe(
          outputs: List[TokenTransfer[TokenType]],
      ): Either[WalletError, (TWallet, TransactionToProve[UnprovenTransaction])] = {
        val offers = outputs.filter(_.amount > BigInt(0)).traverse { tt =>
          zswap.Address
            .fromString[CoinPublicKey, EncPublicKey](tt.receiverAddress.address)
            .map { address =>
              val output = uOut.create(
                ci.create(tt.tokenType, tt.amount),
                address.coinPublicKey,
                address.encryptionPublicKey,
              )
              uo.fromOutput(output, tt.tokenType, tt.amount)
            }
            .toEither
            .leftMap(WalletError.InvalidAddress.apply)
        }

        offers.flatMap(_.reduceLeftOption(_.merge(_)) match
          case Some(offerToBalance) =>
            transactionBalancer
              .balanceOffer(wallet.state, wallet.secretKeys, offerToBalance)
              .map { case (balancedOffer, newState) =>
                (
                  wallet.copy(state = newState),
                  TransactionToProve(ut.create(balancedOffer)),
                )
              }
              .leftMap { case transactionBalancer.NotSufficientFunds(error) =>
                WalletError.NotSufficientFunds(error)
              }
          case None =>
            Left(WalletError.NoTokenTransfers))
      }

      override def balanceTransaction(
          transactionWithCoins: (Transaction, Seq[CoinInfo]),
      ): Either[
        WalletError,
        (TWallet, BalanceTransactionRecipe[UnprovenTransaction, Transaction]),
      ] = {
        val (transactionToBalance, coins) = transactionWithCoins
        transactionBalancer
          .balanceTransaction(wallet.state, wallet.secretKeys, transactionToBalance)
          .map {
            case transactionBalancer.BalanceTransactionResult.BalancedTransactionAndState(
                  unprovenTx,
                  state,
                ) =>
              val updatedState = coins.foldLeft(state)(_.watchFor(wallet.secretKeys, _))
              (
                wallet.copy(state = updatedState),
                BalanceTransactionToProve(unprovenTx, transactionToBalance),
              )
            case transactionBalancer.BalanceTransactionResult.ReadyTransactionAndState(tx, state) =>
              val updatedState = coins.foldLeft(state)(_.watchFor(wallet.secretKeys, _))
              (wallet.copy(state = updatedState), NothingToProve(tx))
          }
          .leftMap { case transactionBalancer.NotSufficientFunds(error) =>
            WalletError.NotSufficientFunds(error)
          }
      }

      override def applyFailedTransaction(
          tx: Transaction,
      ): Either[WalletError, TWallet] =
        wallet
          .applyTransaction(AppliedTransaction(tx, ApplyStage.FailEntirely))
          .asRight

      override def applyFailedUnprovenTransaction(
          tx: UnprovenTransaction,
      ): Either[WalletError, TWallet] = {
        val txProofErased = tx.eraseProofs
        val guaranteedReverted =
          txProofErased.guaranteedCoins.fold(wallet.state)(wallet.state.applyFailedProofErased)
        val newState = txProofErased.fallibleCoins.fold(guaranteedReverted)(
          guaranteedReverted.applyFailedProofErased,
        )
        wallet.copy(state = newState).asRight
      }
    }
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
