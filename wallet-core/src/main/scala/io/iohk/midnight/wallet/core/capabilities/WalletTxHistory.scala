package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.domain.ProgressUpdate

trait WalletTxHistory[TWallet, TTransaction] {
  def updateTxHistory(currentTxs: Seq[TTransaction], newTxs: Seq[TTransaction]): Seq[TTransaction]

  def transactionHistory(wallet: TWallet): Seq[TTransaction]

  def progress(wallet: TWallet): ProgressUpdate
}
