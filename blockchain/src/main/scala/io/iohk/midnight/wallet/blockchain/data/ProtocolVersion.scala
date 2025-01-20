package io.iohk.midnight.wallet.blockchain.data

import cats.Eq
import cats.syntax.eq.*

enum ProtocolVersion(val version: Int) {
  case V1 extends ProtocolVersion(1)
}

object ProtocolVersion {
  given Eq[ProtocolVersion] = Eq.fromUniversalEquals

  def fromInt(value: Int): Either[Exception, ProtocolVersion] = {
    if (value >= 1) Right(ProtocolVersion.V1)
    else Left(new Exception(s"Unknown protocol version: $value"))
  }
}
