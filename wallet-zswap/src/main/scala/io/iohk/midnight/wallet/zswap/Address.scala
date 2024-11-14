package io.iohk.midnight.wallet.zswap

import cats.syntax.eq.*
import scala.util.{Failure, Success, Try}

final case class Address[CPK: CoinPublicKey, EPK: EncryptionPublicKey](
    coinPublicKey: CPK,
    encryptionPublicKey: EPK,
) {
  def asString: String = s"${coinPublicKey.asString}|${encryptionPublicKey.asString}"
}

object Address {
  def fromString[CPK, EPK](
      str: String,
  )(using cpk: CoinPublicKey[CPK], epk: EncryptionPublicKey[EPK]): Try[Address[CPK, EPK]] =
    str.split('|') match {
      case array if array.length === 2 =>
        Success(Address(cpk.create(array(0)), epk.create(array(1))))
      case _ =>
        Failure(Exception(s"Invalid address format $str"))
    }
}
