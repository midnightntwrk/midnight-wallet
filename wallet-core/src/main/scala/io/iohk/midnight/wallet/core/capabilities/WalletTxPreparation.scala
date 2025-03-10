package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{TokenTransfer, ProvingRecipe}

trait WalletTxPreparation[
    TWallet,
    TokenType,
    UnprovenTransaction,
    Transaction,
    CoinPublicKey,
    EncryptionPublicKey,
] {
  def prepareTransferRecipe(
      outputs: List[TokenTransfer[TokenType, CoinPublicKey, EncryptionPublicKey]],
  ): Either[WalletError, (TWallet, ProvingRecipe[UnprovenTransaction, Transaction])]
}
