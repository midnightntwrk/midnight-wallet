package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

trait EncryptionPublicKey[T] {
  def create(string: String): T
  extension (t: T) {
    def asString: String
  }
}

given EncryptionPublicKey[mod.EncPublicKey] with {
  override def create(string: String): mod.EncPublicKey = string
  extension (t: mod.EncPublicKey) {
    override def asString: String = t
  }
}
