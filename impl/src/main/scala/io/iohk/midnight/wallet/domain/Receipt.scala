package io.iohk.midnight.wallet.domain

sealed trait Receipt {
  def message: String
}

object Receipt {
  case object Success extends Receipt {
    override def message: String = "Success"
  }
  case class ContractFailure(code: Int, message: String) extends Receipt
  case class ZKFailure(message: String) extends Receipt
}
