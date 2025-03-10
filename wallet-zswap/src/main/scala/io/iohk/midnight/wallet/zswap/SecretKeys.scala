package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.ArrayOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1

object SecretKeys {
  trait CanInit[T] {
    def fromSeed(seed: Array[Byte]): T
    def fromSeedRng(seed: Array[Byte]): T
  }

  trait HasCoinPublicKey[T, CoinPublicKey] {
    extension (t: T) {
      def coinPublicKey: CoinPublicKey
    }
  }

  trait HasEncryptionPublicKey[T, EncryptionPublicKey] {
    extension (t: T) {
      def encryptionPublicKey: EncryptionPublicKey
    }
  }

  trait HasCoinSecretKey[T, CoinSecretKey] {
    extension (t: T) {
      def coinSecretKey: CoinSecretKey
    }
  }

  trait HasEncryptionSecretKey[T, EncryptionSecretKey] {
    extension (t: T) {
      def encryptionSecretKey: EncryptionSecretKey
    }
  }

  given CanInit[v1.SecretKeys] with {
    override def fromSeed(seed: Array[Byte]): v1.SecretKeys =
      v1.SecretKeys.fromSeed(seed.toUInt8Array)
    override def fromSeedRng(seed: Array[Byte]): v1.SecretKeys =
      v1.SecretKeys.fromSeedRng(seed.toUInt8Array)
  }

  given HasCoinPublicKey[v1.SecretKeys, v1.CoinPublicKey] with {
    extension (secretKeys: v1.SecretKeys) {
      def coinPublicKey: v1.CoinPublicKey = secretKeys.coinPublicKey
    }
  }

  given HasEncryptionPublicKey[v1.SecretKeys, v1.EncPublicKey] with {
    extension (secretKeys: v1.SecretKeys) {
      def encryptionPublicKey: v1.EncPublicKey = secretKeys.encryptionPublicKey
    }
  }

  given HasCoinSecretKey[v1.SecretKeys, v1.CoinSecretKey] with {
    extension (secretKeys: v1.SecretKeys) {
      def coinSecretKey: v1.CoinSecretKey = secretKeys.coinSecretKey
    }
  }

  given HasEncryptionSecretKey[v1.SecretKeys, v1.EncryptionSecretKey] with {
    extension (secretKeys: v1.SecretKeys) {
      def encryptionSecretKey: v1.EncryptionSecretKey = secretKeys.encryptionSecretKey
    }
  }
}
