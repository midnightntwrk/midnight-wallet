package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.midnightZswap.mod

opaque type EncryptionSecretKey = mod.EncryptionSecretKey

object EncryptionSecretKey {
  def fromJs(key: mod.EncryptionSecretKey): EncryptionSecretKey = key
  extension (key: EncryptionSecretKey) {
    def serialize: Array[Byte] =
      key.yesIKnowTheSecurityImplicationsOfThis_serialize().toByteArray
    def test(offer: Offer): Boolean =
      key.test(offer.toJs)
  }
}
