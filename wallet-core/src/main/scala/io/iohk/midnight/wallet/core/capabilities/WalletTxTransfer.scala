package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.TokenTransfer

trait WalletTxTransfer[
    TWallet,
    Transaction,
    UnprovenTransaction,
    TokenType,
    CoinPublicKey,
    EncryptionPublicKey,
] {
  def prepareTransferRecipe(
      outputs: List[TokenTransfer[TokenType, CoinPublicKey, EncryptionPublicKey]],
  ): Either[WalletError, UnprovenTransaction]

  def applyFailedTransaction(wallet: TWallet, tx: Transaction): Either[WalletError, TWallet]

  def applyFailedUnprovenTransaction(
      wallet: TWallet,
      tx: UnprovenTransaction,
  ): Either[WalletError, TWallet]
}
