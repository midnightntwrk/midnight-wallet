package io.iohk.midnight.wallet.ogmios.sync.tracing

import cats.effect.kernel.Sync
import cats.syntax.show.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.AsContextAwareLog
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.tracer.logging.AsStructuredLog
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.tracer.logging.StringLogContext
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.blockchain.data.Hash
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ogmios.sync.tracing.OgmiosSyncEvent.*

class OgmiosSyncTracer[F[_]](
    val tracer: Tracer[F, OgmiosSyncEvent],
) {

  val nextBlockRequested: F[Unit] = tracer(NextBlockRequested)
  def rollForwardReceived(block: Block): F[Unit] = tracer(
    RollForwardReceived(block),
  )
  def rollBackwardReceived(hash: Hash[Block]): F[Unit] = tracer(
    RollBackwardReceived(hash),
  )
  val awaitReplyReceived: F[Unit] = tracer(AwaitReplyReceived)
  def unexpectedMessage(msg: LocalBlockSync.Receive): F[Unit] = tracer(
    UnexpectedMessage(msg),
  )

}

object OgmiosSyncTracer {

  import OgmiosSyncEvent.*
  import OgmiosSyncEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("ogmios_sync")

  implicit val syncEventAsStructuredLog: AsStructuredLog[OgmiosSyncEvent] = {
    case NextBlockRequested        => NextBlockRequested.asContextAwareLog
    case evt: RollForwardReceived  => evt.asContextAwareLog
    case evt: RollBackwardReceived => evt.asContextAwareLog
    case AwaitReplyReceived        => AwaitReplyReceived.asContextAwareLog
    case evt: UnexpectedMessage    => evt.asContextAwareLog
  }

  implicit val nextBlockRequestedAsStructuredLog: AsStructuredLog[NextBlockRequested.type] =
    AsContextAwareLog.instance(
      id = NextBlockRequested.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Next block requested.",
      context = _ => StringLogContext.empty,
    )

  implicit val rollForwardReceivedAsStructuredLog: AsStructuredLog[RollForwardReceived] =
    AsContextAwareLog.instance(
      id = RollForwardReceived.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"[RollForward] to hash [${evt.block.header.hash.show}] received.",
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

  implicit val unexpectedMsgAsStructuredLog: AsStructuredLog[UnexpectedMessage] =
    AsContextAwareLog.instance(
      id = UnexpectedMessage.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Unexpected message received during sync: [${evt.abbreviated}]",
      context = evt => evt.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): OgmiosSyncTracer[F] = {
    val syncTracer: Tracer[F, OgmiosSyncEvent] =
      structuredTracer >=> (evt => Sync[F].delay(evt.asContextAwareLog))
    new OgmiosSyncTracer[F](syncTracer)
  }

}
