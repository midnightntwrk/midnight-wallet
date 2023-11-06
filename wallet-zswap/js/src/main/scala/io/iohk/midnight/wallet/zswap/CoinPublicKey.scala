package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

type CoinPublicKey = mod.CoinPublicKey

object CoinPublicKey {
  def apply(pubKey: String): CoinPublicKey = pubKey
}
