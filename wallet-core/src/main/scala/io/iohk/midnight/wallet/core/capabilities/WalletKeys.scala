package io.iohk.midnight.wallet.core.capabilities

trait WalletKeys[TWallet, TPublicKey] {
  def publicKey(wallet: TWallet): TPublicKey
}
