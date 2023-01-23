package io.iohk.midnight.wallet.ouroboros.sync.tracing

import cats.Show
import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash

sealed trait OuroborosSyncEvent

object OuroborosSyncEvent {

  /** A request to get the next block has been sent to the Ouroboros server/bridge.
    */
  case object NextBlockRequested extends OuroborosSyncEvent {
    val id: Event.Id[NextBlockRequested.type] = Event.Id("next_block_requested")
  }

  /** The server responded with a `RollForward` response.
    */
  final case class RollForwardReceived[Block: Show](block: Block) extends OuroborosSyncEvent {
    def show: String = Show[Block].show(block)
  }

  object RollForwardReceived {
    def id[Block]: Event.Id[RollForwardReceived[Block]] = Event.Id("roll_forward_received")
  }

  /** The server responded with a `RollBackward` response.
    */
  final case class RollBackwardReceived(hash: Hash) extends OuroborosSyncEvent

  object RollBackwardReceived {
    val id: Event.Id[RollBackwardReceived] =
      Event.Id("roll_backward_received")
  }

  /** The server responded with a `AwaitReply` response.
    */
  case object AwaitReplyReceived extends OuroborosSyncEvent {
    val id: Event.Id[AwaitReplyReceived.type] = Event.Id("await_reply_received")
  }

  final case class UnexpectedMessage[Block](message: LocalBlockSync.Receive[Block])
      extends OuroborosSyncEvent {
    val abbreviated: String = s"${message.show.take(10)}..."
  }

  object UnexpectedMessage {
    def id[Block]: Event.Id[UnexpectedMessage[Block]] = Event.Id("unexpected_sync_message")
  }

  object DefaultInstances {

    implicit def rollForwardReceivedContext[Block]: AsStringLogContext[RollForwardReceived[Block]] =
      AsStringLogContext.fromMap[RollForwardReceived[Block]](evt =>
        Map(
          "block_hash" -> evt.show,
        ),
      )

    implicit def rollBackwardReceivedContext: AsStringLogContext[RollBackwardReceived] =
      AsStringLogContext.fromMap[RollBackwardReceived](evt =>
        Map(
          "block_hash" -> evt.hash.show,
        ),
      )

    implicit def unexpectedMsgContext[Block]: AsStringLogContext[UnexpectedMessage[Block]] =
      AsStringLogContext.fromMap[UnexpectedMessage[Block]](evt =>
        Map(
          "message" -> evt.message.show,
        ),
      )
  }
}
