package io.iohk.midnight.wallet.core.parser

import io.iohk.midnight.midnightNtwrkZswap.mod.EncryptionSecretKey
import io.iohk.midnight.wallet.zswap.NetworkId
import scala.util.{Failure, Success}

object EncryptionSecretKeyParser {

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def encodeAsBech32OrThrow[T: Bech32SecretKeyEncoder](secretKey: EncryptionSecretKey)(using
      networkId: NetworkId,
  ): String = {
    Bech32SecretKeyEncoder[T]
      .encode(networkId, secretKey)
      .map(_.asString()) match {
      case Failure(exception) => throw exception
      case Success(value)     => value
    }
  }
}
