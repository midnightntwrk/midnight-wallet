package io.iohk.midnight.wallet.core.capabilities

trait WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier] {
  extension (wallet: TWallet) {
    def coins: Seq[QualifiedCoinInfo]
    def nullifiers: Seq[Nullifier]
    def availableCoins: Seq[QualifiedCoinInfo]
    def pendingCoins: Seq[CoinInfo]
  }
}
