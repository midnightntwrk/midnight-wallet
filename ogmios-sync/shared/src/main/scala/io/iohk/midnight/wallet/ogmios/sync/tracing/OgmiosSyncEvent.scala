package io.iohk.midnight.wallet.ogmios.sync.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.tracer.logging.AsStringLogContext
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.blockchain.data.Hash
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync

sealed trait OgmiosSyncEvent

object OgmiosSyncEvent {

  /** A request to get the next block has been sent to the Ogmios server/bridge.
    */
  case object NextBlockRequested extends OgmiosSyncEvent {
    val id: Event.Id[NextBlockRequested.type] = Event.Id("next_block_requested")
  }

  /** The server responded with a `RollForward` response.
    */
  final case class RollForwardReceived(block: Block) extends OgmiosSyncEvent

  object RollForwardReceived {
    val id: Event.Id[RollForwardReceived] = Event.Id("roll_forward_received")
  }

  /** The server responded with a `RollBackward` response.
    */
  final case class RollBackwardReceived(hash: Hash[Block]) extends OgmiosSyncEvent

  object RollBackwardReceived {
    val id: Event.Id[RollBackwardReceived] = Event.Id("roll_backward_received")
  }

  /** The server responded with a `AwaitReply` response.
    */
  case object AwaitReplyReceived extends OgmiosSyncEvent {
    val id: Event.Id[AwaitReplyReceived.type] = Event.Id("await_reply_received")
  }

  final case class UnexpectedMessage(message: LocalBlockSync.Receive) extends OgmiosSyncEvent {
    val abbreviated: String = s"${message.show.take(10)}..."
  }

  object UnexpectedMessage {
    val id: Event.Id[UnexpectedMessage] = Event.Id("unexpected_sync_message")
  }

  object DefaultInstances {

    implicit val rollForwardReceivedContext: AsStringLogContext[RollForwardReceived] =
      AsStringLogContext.fromMap[RollForwardReceived](evt =>
        Map(
          "block_hash" -> evt.block.header.hash.show,
        ),
      )

    implicit val rollBackwardReceivedContext: AsStringLogContext[RollBackwardReceived] =
      AsStringLogContext.fromMap[RollBackwardReceived](evt =>
        Map(
          "block_hash" -> evt.hash.show,
        ),
      )

    implicit val unexpectedMsgContext: AsStringLogContext[UnexpectedMessage] =
      AsStringLogContext.fromMap[UnexpectedMessage](evt =>
        Map(
          "message" -> evt.message.show,
        ),
      )

  }

}
