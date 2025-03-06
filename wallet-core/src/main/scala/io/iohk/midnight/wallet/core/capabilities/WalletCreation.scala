package io.iohk.midnight.wallet.core.capabilities

trait WalletCreation[TWallet, TState] {
  def create(seed: Array[Byte], initialState: TState): TWallet
}
