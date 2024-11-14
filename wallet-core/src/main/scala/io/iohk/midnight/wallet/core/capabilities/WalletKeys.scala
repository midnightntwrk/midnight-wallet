package io.iohk.midnight.wallet.core.capabilities

trait WalletKeys[TWallet, TCoinPubKey, TEncPubKey, TViewingKey] {
  extension (wallet: TWallet) {
    def coinPublicKey: TCoinPubKey
    def encryptionPublicKey: TEncPubKey
    def viewingKey: TViewingKey
  }
}
