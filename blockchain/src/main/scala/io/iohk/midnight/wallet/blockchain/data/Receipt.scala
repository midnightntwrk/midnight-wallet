package io.iohk.midnight.wallet.blockchain.data

sealed trait Receipt {
  def message: String
}

object Receipt {
  case object Success extends Receipt {
    override def message: String = "Success"
  }
  final case class ContractFailure(code: Int, message: String) extends Receipt
  final case class ZKFailure(message: String) extends Receipt
  final case class LedgerFailure(message: String) extends Receipt
}
