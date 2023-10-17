package io.iohk.midnight.wallet.zswap

import scala.util.{Success, Try}

opaque type Address = String

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object Address {
  def apply(coinPublicKey: CoinPublicKey, encryptionPublicKey: EncryptionPublicKey): Address = ???
  def fromString(str: String): Try[Address] = Success(str)

  extension (address: Address) {
    def asString: String = address
    def coinPublicKey: CoinPublicKey = ???
    def encryptionPublicKey: EncryptionPublicKey = ???
  }
}
