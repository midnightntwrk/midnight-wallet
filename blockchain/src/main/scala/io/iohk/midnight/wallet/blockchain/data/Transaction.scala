package io.iohk.midnight.wallet.blockchain.data

import cats.{Eq, Order, Show}
import cats.syntax.contravariant.*

final case class Transaction(hash: Hash[Transaction], raw: String)

object Transaction {

  implicit val transactionShow: Show[Transaction] = Show.fromToString[Transaction]

  final case class Offset(value: BigInt) {
    def decrement: Offset = Offset(value - 1)
  }

  object Offset {

    given Show[Offset] = Show[BigInt].contramap(_.value)
    given Eq[Offset] = Eq[BigInt].contramap(_.value)
    given Order[Offset] = Order[BigInt].contramap(_.value)

    val Zero: Offset = Offset(0)
  }
}
