package io.iohk.midnight.wallet.core.capabilities

trait WalletCreation[TWallet, TState] {
  def create(initialState: TState): TWallet
}
