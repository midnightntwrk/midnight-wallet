package io.iohk.midnight.wallet.core.instances

import cats.syntax.all.*
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
    Transaction,
    Offer,
    ProofErasedOffer,
](using
    walletTxHistory: WalletTxHistory[Wallet[LocalState, Transaction], Transaction],
    transaction: zswap.Transaction.Transaction[Transaction, Offer],
    evolveState: zswap.LocalState.EvolveState[
      LocalState,
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
    ],
) extends WalletSync[
      Wallet[LocalState, Transaction],
      IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
    ] {
  extension (wallet: Wallet[LocalState, Transaction])
    @JSExport("apply")
    override def apply(
        update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
    ): Either[WalletError, Wallet[LocalState, Transaction]] = applyUpdate(wallet, update)

  def applyUpdate(
      wallet: Wallet[LocalState, Transaction],
      update: IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction],
  ): Either[WalletError, Wallet[LocalState, Transaction]] = {
    update match {
      case ViewingUpdate(protocolVersion, offset, updates) =>
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

              val newTotal = wallet.progress.total match {
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
            progress = wallet.progress.copy(synced = update.synced, total = update.total),
            isConnected = true,
          )
          .asRight

      case ConnectionLost =>
        val progressUpdated = wallet.progress.copy(synced = wallet.progress.synced, total = None)
        wallet.copy(isConnected = false, progress = progressUpdated).asRight
    }
  }
}
