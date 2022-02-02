package io.iohk.midnight.wallet.domain

final case class TransactionWithReceipt(transaction: Transaction, receipt: Receipt)
