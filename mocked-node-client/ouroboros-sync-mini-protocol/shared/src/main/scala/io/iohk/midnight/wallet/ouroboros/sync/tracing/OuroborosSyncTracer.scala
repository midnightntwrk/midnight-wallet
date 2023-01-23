package io.iohk.midnight.wallet.ouroboros.sync.tracing

import cats.Show
import cats.effect.kernel.Sync
import cats.syntax.show.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash
import io.iohk.midnight.wallet.ouroboros.sync.tracing.OuroborosSyncEvent.*

class OuroborosSyncTracer[F[_]](
    val tracer: Tracer[F, OuroborosSyncEvent],
) {

  val nextBlockRequested: F[Unit] = tracer(NextBlockRequested)
  def rollForwardReceived[Block: Show](block: Block): F[Unit] = tracer(
    RollForwardReceived(block),
  )
  def rollBackwardReceived(hash: Hash): F[Unit] = tracer(
    RollBackwardReceived(hash),
  )
  val awaitReplyReceived: F[Unit] = tracer(AwaitReplyReceived)
  def unexpectedMessage[Block](msg: LocalBlockSync.Receive[Block]): F[Unit] = tracer(
    UnexpectedMessage(msg),
  )
}

object OuroborosSyncTracer {

  import OuroborosSyncEvent.*
  import OuroborosSyncEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("ouroboros_sync")

  implicit val syncEventAsStructuredLog: AsStructuredLog[OuroborosSyncEvent] = {
    case NextBlockRequested          => NextBlockRequested.asContextAwareLog
    case evt: RollForwardReceived[?] => evt.asContextAwareLog
    case evt: RollBackwardReceived   => evt.asContextAwareLog
    case AwaitReplyReceived          => AwaitReplyReceived.asContextAwareLog
    case evt: UnexpectedMessage[?]   => evt.asContextAwareLog
  }

  implicit val nextBlockRequestedAsStructuredLog: AsStructuredLog[NextBlockRequested.type] =
    AsContextAwareLog.instance(
      id = NextBlockRequested.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Next block requested.",
      context = _ => StringLogContext.empty,
    )

  implicit def rollForwardReceivedAsStructuredLog[Block]
      : AsStructuredLog[RollForwardReceived[Block]] =
    AsContextAwareLog.instance(
      id = RollForwardReceived.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"[RollForward] to hash [${evt.show}] received.",
      context = _.stringLogContext,
    )

  implicit val rollBackwardReceivedAsStructuredLog: AsStructuredLog[RollBackwardReceived] =
    AsContextAwareLog.instance(
      id = RollBackwardReceived.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"[RollBackward] to hash [${evt.hash.show}] received.",
      context = _.stringLogContext,
    )

  implicit val awaitReplyAsStructuredLog: AsStructuredLog[AwaitReplyReceived.type] =
    AsContextAwareLog.instance(
      id = AwaitReplyReceived.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Next block requested.",
      context = _ => StringLogContext.empty,
    )

  implicit def unexpectedMsgAsStructuredLog[Block]: AsStructuredLog[UnexpectedMessage[Block]] =
    AsContextAwareLog.instance(
      id = UnexpectedMessage.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Unexpected message received during sync: [${evt.abbreviated}]",
      context = evt => evt.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): OuroborosSyncTracer[F] = {
    val syncTracer: Tracer[F, OuroborosSyncEvent] =
      structuredTracer >=> (evt => Sync[F].delay(evt.asContextAwareLog))
    new OuroborosSyncTracer[F](syncTracer)
  }

}
