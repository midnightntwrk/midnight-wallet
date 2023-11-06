package io.iohk.midnight.wallet.zswap

import cats.Eq
import io.iohk.midnight.midnightNtwrkZswap.mod

type Nonce = mod.Nonce

object Nonce {
  given Eq[Nonce] = Eq.instance(_.contentEquals(_))
}
