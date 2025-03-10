package io.iohk.midnight.wallet.engine.parser

import cats.syntax.eq.*
import io.iohk.midnight.midnightNtwrkWalletSdkAddressFormat.mod.{ShieldedAddress, MidnightBech32m}
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.NetworkId

import scala.util.Try

trait Bech32Decoder[T] {
  def decode(netId: NetworkId, value: String): Either[Throwable, T]
}

object Bech32Decoder {

  def apply[A](using d: Bech32Decoder[A]): Bech32Decoder[A] = d

  given Bech32Decoder[ShieldedAddress] with {
    override def decode(netId: NetworkId, value: String): Either[Throwable, ShieldedAddress] =
      Try(ShieldedAddress.codec.decode(netId.toJs, MidnightBech32m.parse(value))).toEither
  }

  given Bech32Decoder[domain.Address[mod.CoinPublicKey, mod.EncPublicKey]] with {

    override def decode(
        networkId: NetworkId,
        value: String,
    ): Either[Throwable, domain.Address[mod.CoinPublicKey, mod.EncPublicKey]] = {
      Bech32Decoder[ShieldedAddress].decode(networkId, value).map { shieldedAddress =>
        val coinPublicKey = shieldedAddress.coinPublicKeyString()
        val encryptionPublicKey = shieldedAddress.encryptionPublicKeyString()
        domain.Address(coinPublicKey, encryptionPublicKey)
      }
    }
  }
}
