package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError

trait WalletStateSerialize[TWallet, TAuxiliary, TSerialized] {
  extension (wallet: TWallet) {
    def serialize: TSerialized
  }

  def deserialize(auxiliary: TAuxiliary, serialized: TSerialized): Either[WalletError, TWallet]
}
