package io.iohk.midnight.wallet.blockchain.data

import cats.Show
import cats.syntax.contravariant.*

final case class Transaction(hash: Hash[Transaction], raw: String)

object Transaction {

  implicit val transactionShow: Show[Transaction] = Show.fromToString[Transaction]

  sealed abstract case class Offset(value: BigInt) {
    def increment: Offset = new Offset(value + 1) {}
  }

  object Offset {

    implicit val offsetShow: Show[Offset] = Show[BigInt].contramap(_.value)

    val Zero: Offset = new Offset(0) {}

    def apply(value: BigInt): Either[String, Offset] =
      Either.cond(
        value >= 0,
        new Offset(value) {},
        s"Transaction offset must be non negative, but was ${value.toString()}",
      )
  }
}
