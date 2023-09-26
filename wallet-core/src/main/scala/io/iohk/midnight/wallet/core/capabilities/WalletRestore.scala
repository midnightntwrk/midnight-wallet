package io.iohk.midnight.wallet.core.capabilities

trait WalletRestore[TWallet, TInput] {
  def restore(input: TInput): TWallet
}
