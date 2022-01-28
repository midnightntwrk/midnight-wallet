package io.iohk.midnight.wallet.clients.platform.protocol

import enumeratum.*
import io.iohk.midnight.wallet.domain.*

sealed trait ReceiveMessage

object ReceiveMessage {
  sealed trait Type extends EnumEntry
  object Type extends Enum[Type] {
    val Discriminator = "protocol"
    case object LocalBlockSync extends Type
    case object LocalTxSubmission extends Type
    val values: IndexedSeq[Type] = findValues
  }

  sealed trait LocalBlockSync extends ReceiveMessage
  object LocalBlockSync {
    sealed trait Type extends EnumEntry
    object Type extends Enum[Type] {
      val Discriminator = "type"
      case object AwaitReply extends Type
      case object RollForward extends Type
      case object RollBackward extends Type
      case object IntersectFound extends Type
      case object IntersectNotFound extends Type
      val values: IndexedSeq[Type] = findValues
    }
    case object AwaitReply extends LocalBlockSync
    case class RollForward(payload: Block) extends LocalBlockSync
    case class RollBackward(payload: Hash[Block]) extends LocalBlockSync
    case class IntersectFound(payload: Hash[Block]) extends LocalBlockSync
    case object IntersectNotFound extends LocalBlockSync
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
    case class RejectTx(payload: RejectTxDetails) extends LocalTxSubmission
    sealed trait RejectTxDetails
    object RejectTxDetails {
      sealed trait Type extends EnumEntry
      object Type extends Enum[Type] {
        val Discriminator = "type"
        case object Duplicate extends Type
        case object Other extends Type
        val values: IndexedSeq[Type] = findValues
      }

      case object Duplicate extends RejectTxDetails

      case class Other(reason: String) extends RejectTxDetails
    }
  }
}
