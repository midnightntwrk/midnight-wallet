package io.iohk.midnight.wallet.engine.parser

import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.NetworkId

import scala.util.{Failure, Success}

object AddressParser {

  def decode[T: Bech32Decoder: HexDecoder](value: String)(using
      networkId: NetworkId,
  ): Either[Throwable, T] = {
    // Try decode as Bech32m.
    Bech32Decoder[T].decode(networkId, value).left.flatMap { bech32Exception =>
      // Fallback to hex decoder.
      HexDecoder[T]
        .decode(value)
        .left
        .map(hexException => CombinedException(bech32Exception, hexException))
    }
  }

  def encodeAsHex[T: HexEncoder](value: T): String = HexEncoder[T].encode(value)

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def encodeAsBech32OrThrow[T: Bech32Encoder](
      address: domain.Address[mod.CoinPublicKey, mod.EncPublicKey],
  )(using networkId: NetworkId): String =
    Bech32Encoder[T]
      .encode(networkId, address)
      .map(_.asString()) match {
      case Failure(exception) => throw exception
      case Success(value)     => value
    }

  final case class CombinedException(bech32Exception: Throwable, hexException: Throwable)
      extends Throwable(
        s"Can't decode an address. Bech32m parse exception: ${bech32Exception.getMessage}. Hex parse exception: ${hexException.getMessage}",
      )
}
