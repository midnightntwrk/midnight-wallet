package io.iohk.midnight.wallet.domain

sealed trait Receipt(message: String)

object Receipt:
  case object Success extends Receipt("Success")
  case class ContractFailure(code: Int, message: String) extends Receipt(message)
  case class ZKFailure(message: String) extends Receipt(message)
