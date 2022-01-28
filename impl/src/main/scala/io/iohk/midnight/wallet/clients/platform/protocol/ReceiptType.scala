package io.iohk.midnight.wallet.clients.platform.protocol

import enumeratum.*

sealed trait ReceiptType extends EnumEntry

object ReceiptType extends Enum[ReceiptType] {
  val Discriminator: String = "type"

  case object Success extends ReceiptType
  case object ContractFailure extends ReceiptType
  case object ZKFailure extends ReceiptType

  val values: IndexedSeq[ReceiptType] = findValues
}
