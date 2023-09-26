package io.iohk.midnight.wallet.zswap

import cats.Eq
import io.iohk.midnight.midnightZswap.mod

type Nonce = mod.Nonce

object Nonce {
  given Eq[Nonce] = Eq.instance(_.contentEquals(_))
}
