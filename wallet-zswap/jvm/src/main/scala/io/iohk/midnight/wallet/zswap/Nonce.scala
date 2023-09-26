package io.iohk.midnight.wallet.zswap

import cats.Eq

opaque type Nonce = Nothing

object Nonce {
  given Eq[Nonce] = Eq.fromUniversalEquals
}
