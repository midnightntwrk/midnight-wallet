package io.iohk.midnight.wallet.blockchain.data

final case class Transaction(header: Transaction.Header, body: ArbitraryJson)

object Transaction {
  final case class Header(hash: Hash[Transaction])
}
