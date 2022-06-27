package io.iohk.midnight.wallet.clients.platform.protocol

import cats.Show
import enumeratum.*
import io.iohk.midnight.wallet.domain.Transaction

sealed trait SendMessage

object SendMessage {
  sealed trait Type extends EnumEntry
  object Type extends Enum[Type] {
    val Discriminator = "protocol"
    case object LocalTxSubmission extends Type
    val values: IndexedSeq[Type] = findValues
  }

  sealed trait LocalTxSubmission extends SendMessage
  object LocalTxSubmission {
    sealed trait Type extends EnumEntry
    object Type extends Enum[Type] {
      val Discriminator = "type"
      case object SubmitTx extends Type
      case object Done extends Type
      val values: IndexedSeq[Type] = findValues
    }
    final case class SubmitTx(payload: Transaction) extends LocalTxSubmission
    case object Done extends LocalTxSubmission
  }

  implicit val showSendMessage: Show[SendMessage] = Show.fromToString[SendMessage]

}
