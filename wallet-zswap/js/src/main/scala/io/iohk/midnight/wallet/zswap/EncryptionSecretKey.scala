package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import scala.util.Try

opaque type EncryptionSecretKey = mod.EncryptionSecretKey

object EncryptionSecretKey {
  def fromJs(key: mod.EncryptionSecretKey): EncryptionSecretKey = key
  extension (key: EncryptionSecretKey) {
    def serialize: String =
      HexUtil.encodeHex(key.yesIKnowTheSecurityImplicationsOfThis_serialize().toByteArray)
    def test(tx: Transaction): Try[Boolean] = Try {
      key.test(tx.toJs.guaranteedCoins) || tx.toJs.fallibleCoins.exists(key.test)
    }
  }
}
