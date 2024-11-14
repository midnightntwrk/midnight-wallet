package io.iohk.midnight.wallet.core.capabilities

trait WalletBalances[TWallet, TokenType] {
  extension (wallet: TWallet) {
    def balance: Map[TokenType, BigInt]
  }
}
