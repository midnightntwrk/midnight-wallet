package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightZswap.mod

type CoinPublicKey = mod.CoinPublicKey

object CoinPublicKey {
  def apply(pubKey: String): CoinPublicKey = pubKey
}
