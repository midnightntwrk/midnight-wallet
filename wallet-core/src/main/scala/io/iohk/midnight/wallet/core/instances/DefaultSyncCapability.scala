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
    LocalStateNoKeys,
    SecretKeys,
    Transaction,
    Offer,
    ProofErasedOffer,
](using
    walletTxHistory: WalletTxHistory[
      Wallet[LocalStateNoKeys, SecretKeys, Transaction],
      Transaction,
    ],
    transaction: zswap.Transaction.Transaction[Transaction, Offer],
    evolveState: zswap.LocalStateNoKeys.EvolveState[
      LocalStateNoKeys,
      SecretKeys,
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
    ],
) extends WalletSync[
      Wallet[LocalStateNoKeys, SecretKeys, Transaction],
      IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
    ] {
  extension (wallet: Wallet[LocalStateNoKeys, SecretKeys, Transaction])
    @JSExport("apply")
    override def apply(
        update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
    ): Either[WalletError, Wallet[LocalStateNoKeys, SecretKeys, Transaction]] =
      applyUpdate(wallet, update)

  def applyUpdate(
      wallet: Wallet[LocalStateNoKeys, SecretKeys, Transaction],
      update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
  ): Either[WalletError, Wallet[LocalStateNoKeys, SecretKeys, Transaction]] = {
    update match {
      case ViewingUpdate(protocolVersion, offset, updates, legacyIndexer) =>
        val newWallet =
          updates.foldLeft(wallet) {
            case (wallet, Left(mt)) => wallet.copy(state = wallet.state.applyCollapsedUpdate(mt))
            case (wallet, Right(AppliedTransaction(tx, stage))) =>
              wallet.applyTransaction(AppliedTransaction[Transaction](tx, stage))
          }
        val newTxs = updates.collect { case Right(tx) => tx }
        newWallet
          .copy(
            txHistory =
              walletTxHistory.updateTxHistory(wallet.txHistory, newTxs.map(_.tx)).toVector,
            offset = Some(offset),
            protocolVersion = protocolVersion,
            isConnected = true,
            progress = {
              val newSynced = offset.decrement

              val newTotal =
                if legacyIndexer then wallet.progress.total
                else
                  wallet.progress.total match {
                    case Some(total) if newSynced.value > total.value => Some(newSynced)
                    case Some(total)                                  => Some(total)
                    case None                                         => None
                  }

              wallet.progress.copy(synced = Some(newSynced), total = newTotal)
            },
          )
          .asRight

      case update: ProgressUpdate =>
        wallet
          .copy(
            progress = {
              update.legacyIndexer match {
                case Some(true) => {
                  wallet.progress.copy(total = update.total)
                }
                case Some(false) => {
                  wallet.progress.copy(synced = update.synced, total = update.total)
                }
                case None => wallet.progress
              }
            },
            isConnected = true,
          )
          .asRight

      case ConnectionLost =>
        val progressUpdated = wallet.progress.copy(synced = wallet.progress.synced, total = None)
        wallet.copy(isConnected = false, progress = progressUpdated).asRight
    }
  }
}
