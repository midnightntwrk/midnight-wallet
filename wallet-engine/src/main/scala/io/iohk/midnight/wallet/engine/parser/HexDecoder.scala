package io.iohk.midnight.wallet.engine.parser

import cats.syntax.eq.*
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.core.domain

trait HexDecoder[T] {
  def decode(value: String): Either[Throwable, T]
}

object HexDecoder {
  def apply[A](using d: HexDecoder[A]): HexDecoder[A] = d

  given HexDecoder[domain.Address[mod.CoinPublicKey, mod.EncPublicKey]] with {
    override def decode(
        value: String,
    ): Either[Throwable, domain.Address[mod.CoinPublicKey, mod.EncPublicKey]] = {
      value.split('|') match {
        case array if array.length === 2 && array(0).length == 64 =>
          Right(domain.Address(array(0), array(1)))
        case _ =>
          Left(Exception(s"Invalid HEX address format $value"))
      }
    }
  }
}
