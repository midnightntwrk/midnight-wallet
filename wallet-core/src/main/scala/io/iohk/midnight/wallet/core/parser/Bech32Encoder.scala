package io.iohk.midnight.wallet.core.parser

import io.iohk.midnight.buffer.mod.Buffer
import io.iohk.midnight.midnightNtwrkWalletSdkAddressFormat.mod.{
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  ShieldedEncryptionSecretKey,
}
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.zswap.NetworkId

import scala.util.Try

trait Bech32Encoder[T] {

  def encode(
      netId: NetworkId,
      address: domain.Address[mod.CoinPublicKey, mod.EncPublicKey],
  ): Try[MidnightBech32m]
}

trait Bech32SecretKeyEncoder[T] {
  def encode(netId: NetworkId, secretKey: mod.EncryptionSecretKey): Try[MidnightBech32m]
}

object Bech32Encoder {

  def apply[A](using e: Bech32Encoder[A]): Bech32Encoder[A] = e

  given Bech32Encoder[ShieldedCoinPublicKey] with {
    override def encode(
        netId: NetworkId,
        address: domain.Address[mod.CoinPublicKey, mod.EncPublicKey],
    ): Try[MidnightBech32m] = Try {
      val cpk = new ShieldedCoinPublicKey(Buffer.from(address.coinPublicKey, "hex"))
      ShieldedCoinPublicKey.codec.encode(netId.toJs, cpk)
    }
  }

  given Bech32Encoder[ShieldedEncryptionPublicKey] with {
    override def encode(
        netId: NetworkId,
        address: domain.Address[mod.CoinPublicKey, mod.EncPublicKey],
    ): Try[MidnightBech32m] = Try {
      val epk = new ShieldedEncryptionPublicKey(Buffer.from(address.encryptionPublicKey, "hex"))
      ShieldedEncryptionPublicKey.codec.encode(netId.toJs, epk)
    }
  }

  given Bech32Encoder[ShieldedAddress] with {
    override def encode(
        netId: NetworkId,
        address: domain.Address[mod.CoinPublicKey, mod.EncPublicKey],
    ): Try[MidnightBech32m] = Try {
      val cpk = new ShieldedCoinPublicKey(Buffer.from(address.coinPublicKey, "hex"))
      val epk = new ShieldedEncryptionPublicKey(Buffer.from(address.encryptionPublicKey, "hex"))
      ShieldedAddress.codec.encode(netId.toJs, new ShieldedAddress(cpk, epk))
    }
  }
}

object Bech32SecretKeyEncoder {
  def apply[A](using e: Bech32SecretKeyEncoder[A]): Bech32SecretKeyEncoder[A] = e

  given Bech32SecretKeyEncoder[ShieldedEncryptionSecretKey] with {
    override def encode(
        netId: NetworkId,
        secretKey: mod.EncryptionSecretKey,
    ): Try[MidnightBech32m] = Try {
      val shESK = new ShieldedEncryptionSecretKey(secretKey)

      ShieldedEncryptionSecretKey.codec.encode(netId.toJs, shESK)
    }
  }
}
