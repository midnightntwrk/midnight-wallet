package io.iohk.midnight.wallet.core.capabilities

trait WalletTxHistory[TWallet, TTransaction] {
  def transactionHistory(wallet: TWallet): Seq[TTransaction]
}
