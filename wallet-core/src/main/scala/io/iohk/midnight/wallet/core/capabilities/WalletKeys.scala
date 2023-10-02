package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.zswap.{EncryptionSecretKey, Transaction}
import scala.util.Try

trait WalletKeys[TWallet, TPublicKey, TViewingKey] {
  def publicKey(wallet: TWallet): TPublicKey

  def viewingKey(wallet: TWallet): TViewingKey
}

object WalletKeys {
  extension [TWallet, TPublicKey](wallet: TWallet) {
    def isRelevant(tx: Transaction)(using
        keys: WalletKeys[TWallet, TPublicKey, EncryptionSecretKey],
    ): Try[Boolean] = keys.viewingKey(wallet).test(tx)
  }
}
