package io.iohk.midnight.wallet.clients.platform.protocol

import cats.Show
import enumeratum.*
import io.iohk.midnight.wallet.domain.{Block, Hash, Transaction}

sealed trait SendMessage

object SendMessage {
  sealed trait Type extends EnumEntry
  object Type extends Enum[Type] {
    val Discriminator = "protocol"
    case object LocalBlockSync extends Type
    case object LocalTxSubmission extends Type
    val values: IndexedSeq[Type] = findValues
  }

  sealed trait LocalBlockSync extends SendMessage
  object LocalBlockSync {
    sealed trait Type extends EnumEntry
    object Type extends Enum[Type] {
      val Discriminator = "type"
      case object RequestNext extends Type
      case object FindIntersect extends Type
      case object Done extends Type
      val values: IndexedSeq[Type] = findValues
    }

    case object RequestNext extends LocalBlockSync
    final case class FindIntersect(payload: Seq[Hash[Block]]) extends LocalBlockSync
    case object Done extends LocalBlockSync
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
