package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError

trait WalletSync[TWallet, TUpdate] {
  def applyUpdate(wallet: TWallet, update: TUpdate): Either[WalletError, TWallet]
}
