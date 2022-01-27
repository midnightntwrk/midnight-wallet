package io.iohk.midnight.wallet.clients.platform.protocol

import io.iohk.midnight.wallet.domain.{Block, Hash, Transaction}

sealed trait SendMessage

object SendMessage:
  object Type extends Enumeration:
    val Discriminator = "protocol"
    val LocalBlockSync = Value("LocalBlockSync")
    val LocalTxSubmission = Value("LocalTxSubmission")

  sealed trait LocalBlockSync extends SendMessage
  object LocalBlockSync:
    object Type extends Enumeration:
      val Discriminator = "type"
      val RequestNext = Value("RequestNext")
      val FindIntersect = Value("FindIntersect")
      val Done = Value("Done")

    case object RequestNext extends LocalBlockSync
    case class FindIntersect(payload: Seq[Hash[Block]]) extends LocalBlockSync
    case object Done extends LocalBlockSync

  sealed trait LocalTxSubmission extends SendMessage
  object LocalTxSubmission:
    object Type extends Enumeration:
      val Discriminator = "type"
      val SubmitTx = Value("SubmitTx")
      val Done = Value("Done")

    case class SubmitTx(payload: Transaction) extends LocalTxSubmission
    case object Done extends LocalTxSubmission
