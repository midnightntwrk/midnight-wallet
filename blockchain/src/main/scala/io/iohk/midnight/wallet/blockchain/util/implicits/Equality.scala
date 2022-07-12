package io.iohk.midnight.wallet.blockchain.util.implicits

import cats.Eq
import io.iohk.midnight.wallet.blockchain.data.{Hash, Nonce, Transaction}

object Equality {
  implicit val txEq: Eq[Transaction] = Eq.fromUniversalEquals
  implicit def hashEq[T]: Eq[Hash[T]] = Eq.fromUniversalEquals[Hash[T]]
  implicit val nonceEq: Eq[Nonce] = Eq.fromUniversalEquals
}
