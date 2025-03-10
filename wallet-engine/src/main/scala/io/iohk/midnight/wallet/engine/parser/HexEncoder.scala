package io.iohk.midnight.wallet.engine.parser

import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.core.domain

trait HexEncoder[T] {
  def encode(value: T): String
}

object HexEncoder {
  def apply[A](using d: HexEncoder[A]): HexEncoder[A] = d

  given HexEncoder[domain.Address[mod.CoinPublicKey, mod.EncPublicKey]] with {
    override def encode(value: domain.Address[mod.CoinPublicKey, mod.EncPublicKey]): String = {
      s"${value.coinPublicKey}|${value.encryptionPublicKey}"
    }
  }
}
