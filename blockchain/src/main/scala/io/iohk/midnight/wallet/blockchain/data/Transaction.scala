package io.iohk.midnight.wallet.blockchain.data

import cats.Show

final case class Transaction(hash: Hash[Transaction], raw: String)

object Transaction {

  implicit val transactionShow: Show[Transaction] = Show.fromToString[Transaction]

}
