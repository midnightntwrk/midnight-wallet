package io.iohk.midnight.wallet.zswap

import cats.Eq
import io.iohk.midnight.midnightNtwrkZswap.mod

object Nonce {
  given Eq[mod.Nonce] = Eq.instance(_.contentEquals(_))
}
