package io.iohk.midnight.wallet.core.combinator

import cats.Eq

enum ProtocolVersion {
  case V1
}

object ProtocolVersion {
  given Eq[ProtocolVersion] = Eq.fromUniversalEquals
}
