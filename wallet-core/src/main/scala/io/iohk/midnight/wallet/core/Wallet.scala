package io.iohk.midnight.wallet.core

import cats.Show
import cats.kernel.Eq
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.zswap

final case class Wallet[LocalState, Transaction](
    state: LocalState,
    txHistory: Vector[Transaction],
    offset: Option[data.Transaction.Offset],
    progress: ProgressUpdate,
    protocolVersion: ProtocolVersion,
    networkId: zswap.NetworkId,
    isConnected: Boolean,
)

class WalletInstances[
    LocalState,
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
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
](using
    zswap.LocalState.HasCoins[LocalState, QualifiedCoinInfo, CoinInfo, UnprovenInput],
    zswap.LocalState.HasKeys[LocalState, CoinPublicKey, EncPublicKey, EncryptionSecretKey],
    zswap.LocalState.EvolveState[LocalState, Offer, ProofErasedOffer, MerkleTreeCollapsedUpdate],
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
    snapshotInstances: SnapshotInstances[LocalState, Transaction],
    uo: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    uOut: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPublicKey, EncPublicKey],
    ut: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    ci: zswap.CoinInfo[CoinInfo, TokenType],
) {
  type TWallet = Wallet[LocalState, Transaction]
  private val transactionBalancer = TransactionBalancer[
    TokenType,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenInput,
    UnprovenOutput,
    LocalState,
    Transaction,
    Offer,
    QualifiedCoinInfo,
    CoinPublicKey,
    EncPublicKey,
    CoinInfo,
  ]

  given walletCreation: WalletCreation[TWallet, Snapshot[LocalState, Transaction]] =
    (snapshot: Snapshot[LocalState, Transaction]) =>
      new TWallet(
        snapshot.state,
        snapshot.txHistory.toVector,
        snapshot.offset,
        ProgressUpdate(snapshot.offset.map(_.decrement), none),
        snapshot.protocolVersion,
        snapshot.networkId,
        isConnected = false,
      )

  given walletBalances: WalletBalances[TWallet, TokenType] with {
    extension (wallet: TWallet) {
      override def balance: Map[TokenType, BigInt] =
        wallet.state.availableCoins.groupMapReduce(_.tokenType)(_.value)(_ + _)
    }
  }

  given walletKeys: WalletKeys[TWallet, CoinPublicKey, EncPublicKey, EncryptionSecretKey] with {
    extension (wallet: TWallet) {
      override def coinPublicKey: CoinPublicKey =
        wallet.state.coinPublicKey
      override def encryptionPublicKey: EncPublicKey =
        wallet.state.encryptionPublicKey
      override def viewingKey: EncryptionSecretKey =
        wallet.state.encryptionSecretKey
    }
  }

  given walletCoins: WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier] with {
    extension (wallet: TWallet) {
      override def coins: Seq[QualifiedCoinInfo] =
        wallet.state.coins
      override def nullifiers: Seq[Nullifier] =
        wallet.state.coins.map(wallet.state.spend(_)._2.nullifier)
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
              .balanceOffer(wallet.state, offerToBalance)
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
            Left(WalletError.NoTokenTransfers),
        )
      }

      override def balanceTransaction(
          transactionWithCoins: (Transaction, Seq[CoinInfo]),
      ): Either[
        WalletError,
        (TWallet, BalanceTransactionRecipe[UnprovenTransaction, Transaction]),
      ] = {
        val (transactionToBalance, coins) = transactionWithCoins
        transactionBalancer
          .balanceTransaction(wallet.state, transactionToBalance)
          .map {
            case transactionBalancer.BalanceTransactionResult.BalancedTransactionAndState(
                  unprovenTx,
                  state,
                ) =>
              val updatedState = coins.foldLeft(state)(_.watchFor(_))
              (
                wallet.copy(state = updatedState),
                BalanceTransactionToProve(unprovenTx, transactionToBalance),
              )
            case transactionBalancer.BalanceTransactionResult.ReadyTransactionAndState(tx, state) =>
              val updatedState = coins.foldLeft(state)(_.watchFor(_))
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
          .copy(state =
            applyTransaction(wallet.state, AppliedTransaction(tx, ApplyStage.FailEntirely)),
          )
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

  given walletSync(using
      walletTxHistory: WalletTxHistory[TWallet, Transaction],
  ): WalletSync[TWallet, IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]] with
    extension (wallet: TWallet) {
      override def apply(
          update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
      ): Either[WalletError, TWallet] =
        update match {
          case ViewingUpdate(protocolVersion, offset, updates) =>
            val newState =
              updates.foldLeft(wallet.state) {
                case (state, Left(mt)) => state.applyCollapsedUpdate(mt)
                case (state, Right(AppliedTransaction(tx, stage))) =>
                  applyTransaction(state, AppliedTransaction[Transaction](tx, stage))
              }
            val newTxs = updates.collect { case Right(tx) => tx }
            wallet
              .copy(
                state = newState,
                txHistory =
                  walletTxHistory.updateTxHistory(wallet.txHistory, newTxs.map(_.tx)).toVector,
                offset = Some(offset),
                protocolVersion = protocolVersion,
                isConnected = true,
                progress = wallet.progress.copy(synced = Some(offset.decrement)),
              )
              .asRight

          case update: ProgressUpdate =>
            wallet
              .copy(
                progress = wallet.progress.copy(total = update.total),
                isConnected = true,
              )
              .asRight

          case ConnectionLost =>
            val progressUpdated = wallet.progress.copy(wallet.progress.synced, total = None)
            wallet.copy(isConnected = false, progress = progressUpdated).asRight
        }
    }

  private def applyTransaction[TX: zswap.Transaction.Transaction[*, Offer]](
      state: LocalState,
      transaction: AppliedTransaction[TX],
  ): LocalState = {
    val tx = transaction.tx
    transaction.applyStage match {
      case ApplyStage.FailEntirely =>
        val guaranteed = tx.guaranteedCoins.fold(state)(state.applyFailed)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.FailFallible =>
        val guaranteed = tx.guaranteedCoins.fold(state)(state.apply)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.SucceedEntirely =>
        val guaranteed = transaction.tx.guaranteedCoins.fold(state)(state.apply)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.apply)
    }
  }

  val walletTxHistory = new WalletTxHistory[TWallet, Transaction] {
    override def updateTxHistory(
        currentTxs: Seq[Transaction],
        newTxs: Seq[Transaction],
    ): Seq[Transaction] = currentTxs ++ newTxs
    extension (wallet: TWallet) {
      override def transactionHistory: Seq[Transaction] = wallet.txHistory
      override def progress: ProgressUpdate = wallet.progress
    }
  }

  val walletDiscardTxHistory = new WalletTxHistory[TWallet, Transaction] {
    override def updateTxHistory(
        currentTxs: Seq[Transaction],
        newTxs: Seq[Transaction],
    ): Seq[Transaction] = Seq.empty
    extension (wallet: TWallet) {
      override def transactionHistory: Seq[Transaction] = wallet.txHistory
      override def progress: ProgressUpdate = wallet.progress
    }
  }

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
}
