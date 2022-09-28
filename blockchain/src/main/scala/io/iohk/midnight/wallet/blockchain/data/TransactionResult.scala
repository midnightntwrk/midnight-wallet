package io.iohk.midnight.wallet.blockchain.data

final case class TransactionResult(transaction: Transaction, result: TransactionResult.Result)

object TransactionResult {
  type Result = String
}
