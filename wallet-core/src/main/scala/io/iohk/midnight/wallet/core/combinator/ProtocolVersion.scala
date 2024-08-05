package io.iohk.midnight.wallet.core.combinator

import cats.Eq
import cats.syntax.eq.*

enum ProtocolVersion(val version: Int) {
  case V1 extends ProtocolVersion(1)
}

object ProtocolVersion {
  given Eq[ProtocolVersion] = Eq.fromUniversalEquals

  def fromInt(value: Int): Either[Exception, ProtocolVersion] =
    values.find(_.version === value).toRight(Exception(s"Invalid protocol version $value"))
}
