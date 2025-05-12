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
import io.iohk.midnight.wallet.zswap.UnprovenOutput.Segment
import io.iohk.midnight.wallet.zswap
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
)(using
    snapshotInstances: SnapshotInstances[LocalState, Transaction],
    secretKeys: zswap.SecretKeys.CanInit[SecretKeys],
    unprovenOffer: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    unprovenOutput: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPublicKey, EncPublicKey],
    unprovenTx: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    coinInfo: zswap.CoinInfo[CoinInfo, TokenType],
) {
  type TWallet = Wallet[LocalState, SecretKeys, Transaction]
  private val transactionBalancer = TransactionBalancer[
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

  given walletCoins: WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier] with {
    extension (wallet: TWallet) {
      override def coins: Seq[QualifiedCoinInfo] =
        wallet.state.coins
      override def nullifiers: Seq[Nullifier] =
        wallet.state.coins.map(
          wallet.state.spend(Segment.Guaranteed, wallet.secretKeys, _)._2.nullifier,
        )
      override def availableCoins: Seq[QualifiedCoinInfo] =
        wallet.state.availableCoins
      override def pendingCoins: Seq[CoinInfo] =
        wallet.state.pendingOutputs
    }
  }

  given walletTxBalancing: WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, CoinInfo] =
    (
        wallet: TWallet,
        transactionWithCoins: (Either[Transaction, UnprovenTransaction], Seq[CoinInfo]),
    ) => {
      val recipeResult =
        transactionBalancer.balanceTx(wallet.state.availableCoins, transactionWithCoins._1)

      val result = recipeResult.flatMap {
        case ((guaranteedInputs, guaranteedOutputs), (fallibleInputs, fallibleOutputs)) =>
          Either.catchNonFatal {
            // Process recipe parts (inputs + outputs) and return updated state and offer
            def processRecipe(
                segment: Segment,
                startingState: LocalState,
                secretKeys: SecretKeys,
                inputs: List[QualifiedCoinInfo],
                outputs: List[CoinInfo],
            ): (LocalState, UnprovenOffer) = {
              val startingOffer = unprovenOffer()
              // Process inputs
              val (stateAfterInputs, offerAfterInputs) =
                inputs.foldLeft((startingState, startingOffer)) { case ((state, offer), coin) =>
                  val (newState, unprovenInput) = state.spend(segment, secretKeys, coin)
                  val newOffer =
                    offer.merge(unprovenOffer.fromInput(unprovenInput, coin.tokenType, coin.value))
                  (newState, newOffer)
                }

              // Process outputs
              outputs.foldLeft((stateAfterInputs, offerAfterInputs)) {
                case ((state, offer), coin) =>
                  val unprovenOutputValue =
                    unprovenOutput.create(
                      segment,
                      coin,
                      secretKeys.coinPublicKey,
                      secretKeys.encryptionPublicKey,
                    )
                  val newOffer = offer.merge(
                    unprovenOffer.fromOutput(unprovenOutputValue, coin.tokenType, coin.value),
                  )
                  val newState = state.watchFor(secretKeys, coin)
                  (newState, newOffer)
              }
            }

            // Process guaranteed part first
            val (stateAfterGuaranteed, guaranteedOffer) = processRecipe(
              Segment.Guaranteed,
              wallet.state,
              wallet.secretKeys,
              guaranteedInputs,
              guaranteedOutputs,
            )

            val (finalState, finalTx) = if (fallibleInputs.isEmpty && fallibleOutputs.isEmpty) {
              // Skip fallible part completely if either inputs or outputs are empty
              (stateAfterGuaranteed, unprovenTx.create(guaranteedOffer))
            } else {
              // Only process fallible part when both inputs and outputs exist
              val (updatedState, fallibleOffer) = processRecipe(
                Segment.Fallible,
                stateAfterGuaranteed,
                wallet.secretKeys,
                fallibleInputs,
                fallibleOutputs,
              )
              (updatedState, unprovenTx.create(guaranteedOffer, fallibleOffer))
            }

            transactionBalancer.BalanceTransactionResult.BalancedTransactionAndState(
              finalTx,
              finalState,
            )
          }
      }

      handleBalancingResult(result, wallet, transactionWithCoins)
    }

  given walletTxTransfer: WalletTxTransfer[
    TWallet,
    Transaction,
    UnprovenTransaction,
    TokenType,
    CoinPublicKey,
    EncPublicKey,
  ] =
    new WalletTxTransfer[
      TWallet,
      Transaction,
      UnprovenTransaction,
      TokenType,
      CoinPublicKey,
      EncPublicKey,
    ] {
      override def prepareTransferRecipe(
          outputs: List[TokenTransfer[TokenType, CoinPublicKey, EncPublicKey]],
      ): Either[WalletError, UnprovenTransaction] = {
        val offers = outputs.filter(_.amount > BigInt(0)).traverse { tt =>
          val output = unprovenOutput.create(
            Segment.Guaranteed,
            coinInfo.create(tt.tokenType, tt.amount),
            tt.receiverAddress.coinPublicKey,
            tt.receiverAddress.encryptionPublicKey,
          )
          Either.right(unprovenOffer.fromOutput(output, tt.tokenType, tt.amount))
        }

        offers.flatMap(_.reduceLeftOption(_.merge(_)) match
          case Some(offer) =>
            Right(unprovenTx.create(offer))
          case None =>
            Left(WalletError.NoTokenTransfers))
      }

      override def applyFailedTransaction(
          wallet: TWallet,
          tx: Transaction,
      ): Either[WalletError, TWallet] =
        wallet
          .applyTransaction(AppliedTransaction(tx, ApplyStage.FailEntirely))
          .asRight

      override def applyFailedUnprovenTransaction(
          wallet: TWallet,
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

  private def handleBalancingResult(
      result: Either[Throwable, transactionBalancer.BalanceTransactionResult],
      wallet: TWallet,
      transactionWithCoins: (Either[Transaction, UnprovenTransaction], Seq[CoinInfo]),
  ): Either[
    WalletError,
    (
        TWallet,
        (TransactionToProve[UnprovenTransaction] |
          BalanceTransactionToProve[UnprovenTransaction, Transaction] |
          NothingToProve[UnprovenTransaction, Transaction]),
    ),
  ] = {
    val (originalTransaction, coins) = transactionWithCoins
    result
      .map {
        case transactionBalancer.BalanceTransactionResult.BalancedTransactionAndState(
              unprovenTx,
              state,
            ) => {
          val updatedState = coins.foldLeft(state) { (currentState, coin) =>
            currentState.watchFor(wallet.secretKeys, coin)
          }
          val updatedWallet = wallet.copy(state = updatedState)
          originalTransaction match {
            case Right(unprovenOriginalTx) =>
              val transactionToBalance = unprovenOriginalTx.merge(unprovenTx)
              (
                updatedWallet,
                TransactionToProve(transactionToBalance),
              )
            case Left(originalTx) =>
              (
                updatedWallet,
                BalanceTransactionToProve(unprovenTx, originalTx),
              )
          }
        }
        case transactionBalancer.BalanceTransactionResult.ReadyTransactionAndState(tx, state) =>
          val updatedState = coins.foldLeft(state) { (currentState, coin) =>
            currentState.watchFor(wallet.secretKeys, coin)
          }
          (wallet.copy(state = updatedState), NothingToProve(tx))
      }
      .leftMap { case transactionBalancer.NotSufficientFunds(error) =>
        WalletError.NotSufficientFunds(error)
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
