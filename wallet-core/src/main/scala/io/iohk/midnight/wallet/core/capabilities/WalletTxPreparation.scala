package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{TokenTransfer, ProvingRecipe}

trait WalletTxPreparation[TWallet] {
  def prepareTransferRecipe(
      wallet: TWallet,
      outputs: List[TokenTransfer],
  ): Either[WalletError, (TWallet, ProvingRecipe)]
}
