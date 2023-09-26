package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError

// TODO Use WalletSync instead of this
trait WalletTransactionProcessing[TWallet, TTransaction] {
  def applyTransaction(wallet: TWallet, transaction: TTransaction): Either[WalletError, TWallet]
}
