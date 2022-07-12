package io.iohk.midnight.wallet.blockchain.data

final case class TransactionWithReceipt(transaction: Transaction, receipt: Receipt)
