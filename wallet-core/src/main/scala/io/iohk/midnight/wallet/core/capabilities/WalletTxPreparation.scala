package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{TokenTransfer, ProvingRecipe}

trait WalletTxPreparation[TWallet, TokenType, UnprovenTransaction, Transaction] {
  def prepareTransferRecipe(
      wallet: TWallet,
      outputs: List[TokenTransfer[TokenType]],
  ): Either[WalletError, (TWallet, ProvingRecipe[UnprovenTransaction, Transaction])]
}
