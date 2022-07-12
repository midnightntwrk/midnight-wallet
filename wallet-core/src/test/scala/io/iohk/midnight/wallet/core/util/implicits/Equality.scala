package io.iohk.midnight.wallet.core.util.implicits

import cats.Eq
import sttp.client3.RequestBody

object Equality {
  implicit def reqBodyEq[T]: Eq[RequestBody[T]] = Eq.fromUniversalEquals
}
