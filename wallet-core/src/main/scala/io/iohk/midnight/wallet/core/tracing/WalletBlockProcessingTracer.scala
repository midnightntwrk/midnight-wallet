package io.iohk.midnight.wallet.core.tracing

import cats.effect.kernel.Sync
import cats.syntax.show.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.tracing.WalletBlockProcessingEvent.*

class WalletBlockProcessingTracer[F[_]](val tracer: Tracer[F, WalletBlockProcessingEvent]) {
  def handlingBlock(block: Block): F[Unit] = tracer(BlockProcessingHandlingBlock(block))
  def applyBlockSuccess(block: Block): F[Unit] = tracer(
    ApplyBlockSuccess(block),
  )
  def applyBlockError(block: Block, error: WalletError): F[Unit] = tracer(
    ApplyBlockError(block, error),
  )
}

object WalletBlockProcessingTracer {

  import WalletBlockProcessingEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_block_processing")

  implicit val walletBlockProcessingEventAsStructuredLog
      : AsStructuredLog[WalletBlockProcessingEvent] = {
    case evt: BlockProcessingHandlingBlock => evt.asContextAwareLog
    case evt: ApplyBlockSuccess            => evt.asContextAwareLog
    case evt: ApplyBlockError              => evt.asContextAwareLog
  }

  implicit val blockProcessingHandlingBlockAsStructuredLog
      : AsStructuredLog[BlockProcessingHandlingBlock] =
    AsContextAwareLog.instance(
      id = BlockProcessingHandlingBlock.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Starting applying block [${evt.block.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val applyBlockSuccessAsStructuredLog: AsStructuredLog[ApplyBlockSuccess] =
    AsContextAwareLog.instance(
      id = ApplyBlockSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Successfully applied block [${evt.block.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val applyBlockErrorAsStructuredLog: AsStructuredLog[ApplyBlockError] =
    AsContextAwareLog.instance(
      id = ApplyBlockError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Error while applying block [${evt.block.header.hash.show}].",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletBlockProcessingTracer[F] = {
    val eventTracer: Tracer[F, WalletBlockProcessingEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new WalletBlockProcessingTracer[F](eventTracer)
  }

}
