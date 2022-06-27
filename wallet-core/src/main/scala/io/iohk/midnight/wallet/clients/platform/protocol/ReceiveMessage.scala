package io.iohk.midnight.wallet.clients.platform.protocol

import cats.Show
import enumeratum.*

sealed trait ReceiveMessage

object ReceiveMessage {
  sealed trait Type extends EnumEntry
  object Type extends Enum[Type] {
    val Discriminator = "protocol"
    case object LocalTxSubmission extends Type
    val values: IndexedSeq[Type] = findValues
  }

  sealed abstract class LocalTxSubmission extends ReceiveMessage
  object LocalTxSubmission {
    sealed trait Type extends EnumEntry
    object Type extends Enum[Type] {
      val Discriminator = "type"
      case object AcceptTx extends Type
      case object RejectTx extends Type
      val values: IndexedSeq[Type] = findValues
    }

    case object AcceptTx extends LocalTxSubmission
    final case class RejectTx(payload: RejectTxDetails) extends LocalTxSubmission
    sealed trait RejectTxDetails {
      def reason: String
    }
    object RejectTxDetails {
      sealed trait Type extends EnumEntry
      object Type extends Enum[Type] {
        val Discriminator = "type"
        case object Duplicate extends Type
        case object Other extends Type
        val values: IndexedSeq[Type] = findValues
      }
      case object Duplicate extends RejectTxDetails {
        override def reason: String = "Duplicate"
      }
      final case class Other(reason: String) extends RejectTxDetails
    }
  }

  implicit val showReceiveMessage: Show[ReceiveMessage] = Show.fromToString[ReceiveMessage]
}
