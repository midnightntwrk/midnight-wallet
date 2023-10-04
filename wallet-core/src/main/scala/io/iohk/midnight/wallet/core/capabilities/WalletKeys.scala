package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.zswap.{EncryptionSecretKey, Transaction}
import scala.util.Try

trait WalletKeys[TWallet, TCoinPubKey, TEncPubKey, TViewingKey] {
  def coinPublicKey(wallet: TWallet): TCoinPubKey

  def encryptionPublicKey(wallet: TWallet): TEncPubKey

  def viewingKey(wallet: TWallet): TViewingKey
}

object WalletKeys {
  extension [TWallet, TCoinPubKey, TEncPubKey](wallet: TWallet) {
    def isRelevant(tx: Transaction)(using
        keys: WalletKeys[TWallet, TCoinPubKey, TEncPubKey, EncryptionSecretKey],
    ): Try[Boolean] = keys.viewingKey(wallet).test(tx)
  }
}
