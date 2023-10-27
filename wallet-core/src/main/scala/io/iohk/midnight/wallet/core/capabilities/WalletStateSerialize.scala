package io.iohk.midnight.wallet.core.capabilities

trait WalletStateSerialize[TWallet, TSerialized] {
  def serialize(wallet: TWallet): TSerialized
}
