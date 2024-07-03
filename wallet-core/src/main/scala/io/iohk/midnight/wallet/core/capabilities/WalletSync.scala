package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError

trait WalletSync[TWallet, TUpdate] {
  extension (wallet: TWallet) def apply(update: TUpdate): Either[WalletError, TWallet]
}
