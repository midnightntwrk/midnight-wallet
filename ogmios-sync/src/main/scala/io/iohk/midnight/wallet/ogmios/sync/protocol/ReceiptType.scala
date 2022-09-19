package io.iohk.midnight.wallet.ogmios.sync.protocol

import io.iohk.midnight.wallet.ogmios.util.Enumeration

private[sync] sealed abstract class ReceiptType(val entryName: String)
    extends Enumeration.Value(entryName)

private[sync] object ReceiptType {
  val Discriminator: String = "type"

  case object Success extends ReceiptType("Success")
  case object ContractFailure extends ReceiptType("ContractFailure")
  case object ZKFailure extends ReceiptType("ZKFailure")
  case object LedgerFailure extends ReceiptType("LedgerFailure")

  implicit val enumInstance: Enumeration[ReceiptType] = new Enumeration[ReceiptType] {
    override val Discriminator: String = ReceiptType.Discriminator
    override val allValues: Seq[ReceiptType] =
      Seq(Success, ContractFailure, ZKFailure, LedgerFailure)
  }
}
