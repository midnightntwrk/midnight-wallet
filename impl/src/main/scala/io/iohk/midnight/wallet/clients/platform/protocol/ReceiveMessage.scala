package io.iohk.midnight.wallet.clients.platform.protocol

import io.iohk.midnight.wallet.domain.*

sealed trait ReceiveMessage

object ReceiveMessage:
  object Type extends Enumeration:
    val Discriminator = "protocol"
    val LocalBlockSync = Value("LocalBlockSync")
    val LocalTxSubmission = Value("LocalTxSubmission")

  sealed trait LocalBlockSync extends ReceiveMessage
  object LocalBlockSync:
    object Type extends Enumeration:
      val Discriminator = "type"
      val AwaitReply = Value("AwaitReply")
      val RollForward = Value("RollForward")
      val RollBackward = Value("RollBackward")
      val IntersectFound = Value("IntersectFound")
      val IntersectNotFound = Value("IntersectNotFound")

    case object AwaitReply extends LocalBlockSync
    case class RollForward(payload: Block) extends LocalBlockSync
    case class RollBackward(payload: Hash[Block]) extends LocalBlockSync
    case class IntersectFound(payload: Hash[Block]) extends LocalBlockSync
    case object IntersectNotFound extends LocalBlockSync

  sealed abstract class LocalTxSubmission extends ReceiveMessage
  object LocalTxSubmission:
    object Type extends Enumeration:
      val Discriminator = "type"
      val AcceptTx = Value("AcceptTx")
      val RejectTx = Value("RejectTx")

    case object AcceptTx extends LocalTxSubmission
    case class RejectTx(payload: RejectTxDetails) extends LocalTxSubmission
    sealed trait RejectTxDetails
    object RejectTxDetails:
      object Type extends Enumeration:
        val Discriminator = "type"
        val Duplicate = Value("Duplicate")
        val Other = Value("Other")

      case object Duplicate extends RejectTxDetails
      case class Other(reason: String) extends RejectTxDetails
