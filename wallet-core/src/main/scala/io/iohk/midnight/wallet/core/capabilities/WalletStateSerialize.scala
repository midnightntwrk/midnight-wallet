package io.iohk.midnight.wallet.core.capabilities

trait WalletStateSerialize[TWallet, TSerialized] {
  extension (wallet: TWallet) {
    def serialize: TSerialized
  }
}
