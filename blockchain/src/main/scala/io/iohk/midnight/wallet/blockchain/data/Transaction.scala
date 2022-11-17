package io.iohk.midnight.wallet.blockchain.data

import cats.Show

final case class Transaction(header: Transaction.Header, body: String)

object Transaction {

  implicit val transactionShow: Show[Transaction] = Show.fromToString[Transaction]

  final case class Header(hash: Hash[Transaction])

  object Header {
    implicit val headerShow: Show[Header] = Show.fromToString[Header]
  }

}
