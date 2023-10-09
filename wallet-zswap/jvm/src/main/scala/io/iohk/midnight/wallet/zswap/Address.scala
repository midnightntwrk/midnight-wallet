package io.iohk.midnight.wallet.zswap

import scala.util.Try

opaque type Address = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object Address {
  def apply(coinPublicKey: CoinPublicKey, encryptionPublicKey: EncryptionPublicKey): Address = ???
  def fromString(str: String): Try[Address] = ???

  extension (address: Address) {
    def coinPublicKey: CoinPublicKey = ???
    def encryptionPublicKey: EncryptionPublicKey = ???
  }
}
