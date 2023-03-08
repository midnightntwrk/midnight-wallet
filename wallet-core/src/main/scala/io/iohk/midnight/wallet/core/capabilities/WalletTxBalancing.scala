package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError

trait WalletTxBalancing[TWallet, TTransaction, TCoin] {
  def balanceTransaction(
      wallet: TWallet,
      transactionWithCoins: (TTransaction, Seq[TCoin]),
  ): Either[WalletError, (TWallet, TTransaction)]
}
