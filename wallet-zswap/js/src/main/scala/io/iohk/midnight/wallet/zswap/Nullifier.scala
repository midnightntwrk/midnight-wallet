package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

opaque type Nullifier = mod.Nullifier

object Nullifier {
  extension (nullifier: Nullifier) {
    def toJs: mod.Nullifier = nullifier
  }

  def fromJs(n: mod.Nullifier): Nullifier = n
}
