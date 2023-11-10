package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.domain.ProgressUpdate

trait WalletTxHistory[TWallet, TTransaction] {
  def transactionHistory(wallet: TWallet): Seq[TTransaction]

  def progress(wallet: TWallet): Option[ProgressUpdate]
}
