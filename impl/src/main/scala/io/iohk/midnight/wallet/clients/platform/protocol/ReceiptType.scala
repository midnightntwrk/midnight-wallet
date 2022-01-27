package io.iohk.midnight.wallet.clients.platform.protocol

object ReceiptType extends Enumeration:
  val Discriminator: String = "type"
  val Success = Value("Success")
  val ContractFailure = Value("ContractFailure")
  val ZKFailure = Value("ZKFailure")
