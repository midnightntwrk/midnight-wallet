package io.iohk.midnight.wallet.core.instances

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core.capabilities.{WalletSync, WalletTxHistory}
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.{Wallet, WalletError}
import io.iohk.midnight.wallet.zswap

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportAll, JSExportTopLevel}

@JSExportTopLevel("DefaultSyncCapability")
@JSExportAll
class DefaultSyncCapability[
    MerkleTreeCollapsedUpdate,
    LocalState,
    SecretKeys,
    Transaction,
    Offer,
    ProofErasedOffer,
](using
    walletTxHistory: WalletTxHistory[
      Wallet[LocalState, SecretKeys, Transaction],
      Transaction,
    ],
    transaction: zswap.Transaction.Transaction[Transaction, Offer],
    evolveState: zswap.LocalState.EvolveState[
      LocalState,
      SecretKeys,
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
    ],
) extends WalletSync[
      Wallet[LocalState, SecretKeys, Transaction],
      IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
    ] {
  extension (wallet: Wallet[LocalState, SecretKeys, Transaction])
    @JSExport("apply")
    override def apply(
        update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
    ): Either[WalletError, Wallet[LocalState, SecretKeys, Transaction]] =
      applyUpdate(wallet, update)

  def applyUpdate(
      wallet: Wallet[LocalState, SecretKeys, Transaction],
      update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
  ): Either[WalletError, Wallet[LocalState, SecretKeys, Transaction]] = {
    update match {
      case ViewingUpdate(protocolVersion, offset, updates) =>
        val newWallet =
          updates.foldLeft(wallet) {
            case (wallet, Left(mt)) => wallet.copy(state = wallet.state.applyCollapsedUpdate(mt))
            case (wallet, Right(AppliedTransaction(tx, stage))) =>
              val updatedWallet =
                wallet.applyTransaction(AppliedTransaction[Transaction](tx, stage))

              val appliedIndex = stage match {
                case ApplyStage.FailEntirely => offset
                case _                       => offset.decrement
              }

              updatedWallet.copy(
                progress = {
                  wallet.progress.copy(appliedIndex = Some(appliedIndex))
                },
                offset = Some(offset),
                protocolVersion = protocolVersion,
                isConnected = true,
              )
          }
        val newTxs = updates.collect { case Right(tx) => tx }
        newWallet
          .copy(
            txHistory = walletTxHistory.updateTxHistory(wallet.txHistory, newTxs.map(_.tx)).toVector,
          )
          .asRight

      case update: ProgressUpdate =>
        wallet
          .copy(
            progress = {
              wallet.progress.copy(
                highestRelevantWalletIndex = update.highestRelevantWalletIndex,
                highestIndex = update.highestIndex,
                highestRelevantIndex = update.highestRelevantIndex,
              )
            },
            isConnected = true,
          )
          .asRight

      case ConnectionLost =>
        val progressUpdated = wallet.progress.copy(appliedIndex = None)
        wallet.copy(isConnected = false, progress = progressUpdated).asRight
    }
  }
}
