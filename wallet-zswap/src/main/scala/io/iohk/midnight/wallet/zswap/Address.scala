package io.iohk.midnight.wallet.zswap

import cats.syntax.eq.*
import scala.util.{Failure, Success, Try}

final case class Address(coinPublicKey: CoinPublicKey, encryptionPublicKey: EncryptionPublicKey) {
  def asString: String = s"$coinPublicKey|$encryptionPublicKey"
}

object Address {
  def fromString(str: String): Try[Address] =
    str.split('|') match {
      case array if array.length === 2 => Success(Address(array(0), array(1)))
      case _                           => Failure(Exception(s"Invalid address format $str"))
    }
}
