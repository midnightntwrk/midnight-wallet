package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

trait CoinPublicKey[T] {
  def create(pubKey: String): T
  extension (t: T) {
    def asString: String
  }
}

given CoinPublicKey[mod.CoinPublicKey] with {
  override def create(pubKey: String): mod.CoinPublicKey = pubKey
  extension (t: mod.CoinPublicKey) {
    override def asString: String = t
  }
}
