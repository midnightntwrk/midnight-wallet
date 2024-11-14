package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import scala.util.Try

trait EncryptionSecretKey[T, Transaction] {
  extension (t: T) {
    def serialize(using networkId: NetworkId): String
    def test(tx: Transaction): Try[Boolean]
  }
}

given v1ESK: EncryptionSecretKey[mod.EncryptionSecretKey, mod.Transaction] with {
  extension (key: mod.EncryptionSecretKey) {
    def serialize(using networkId: NetworkId): String =
      HexUtil.encodeHex(
        key.yesIKnowTheSecurityImplicationsOfThis_serialize(networkId.toJs).toByteArray,
      )
    def test(tx: mod.Transaction): Try[Boolean] = Try {
      tx.guaranteedCoins.exists(key.test) || tx.fallibleCoins.exists(key.test)
    }
  }
}
