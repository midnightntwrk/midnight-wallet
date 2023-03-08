package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError

trait WalletBlockProcessing[TWallet, TBlock] {
  def applyBlock(wallet: TWallet, block: TBlock): Either[WalletError, TWallet]
}
