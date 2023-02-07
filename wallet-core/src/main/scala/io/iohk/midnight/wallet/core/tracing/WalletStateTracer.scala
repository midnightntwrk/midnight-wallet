package io.iohk.midnight.wallet.core.tracing

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
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.midnightLedger.mod
import WalletStateEvent.*
import io.iohk.midnight.wallet.core.LedgerSerialization

class WalletStateTracer[F[_]](val tracer: Tracer[F, WalletStateEvent]) {
  def handlingBlock(block: Block): F[Unit] = tracer(StateUpdateHandlingBlock(block))
  def updateStateStart(tx: data.Transaction): F[Unit] = tracer(
    StateUpdateStart(tx),
  )
  def updateStateSuccess(tx: mod.Transaction): F[Unit] = tracer(
    StateUpdateSuccess(LedgerSerialization.toTransaction(tx)),
  )
  def updateStateError(tx: mod.Transaction, error: Throwable): F[Unit] = tracer(
    StateUpdateError(LedgerSerialization.toTransaction(tx), error),
  )
}

object WalletStateTracer {

  import WalletStateEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_state")

  implicit val walletStateEventAsStructuredLog: AsStructuredLog[WalletStateEvent] = {
    case evt: StateUpdateHandlingBlock => evt.asContextAwareLog
    case evt: StateUpdateStart         => evt.asContextAwareLog
    case evt: StateUpdateSuccess       => evt.asContextAwareLog
    case evt: StateUpdateError         => evt.asContextAwareLog
  }

  implicit val stateUpdateHandlingBlockAsStructuredLog: AsStructuredLog[StateUpdateHandlingBlock] =
    AsContextAwareLog.instance(
      id = StateUpdateHandlingBlock.id,
      component = Component,
      level = LogLevel.Debug,
      message =
        evt => s"Updating state with transactions from block [${evt.block.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val stateUpdateStartAsStructuredLog: AsStructuredLog[StateUpdateStart] =
    AsContextAwareLog.instance(
      id = StateUpdateStart.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Starting to update state with transaction [${evt.tx.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val stateUpdateSuccessAsStructuredLog: AsStructuredLog[StateUpdateSuccess] =
    AsContextAwareLog.instance(
      id = StateUpdateSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Successfully updated state with transaction [${evt.tx.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val stateUpdateErrorAsStructuredLog: AsStructuredLog[StateUpdateError] =
    AsContextAwareLog.instance(
      id = StateUpdateError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Error while updating state with transaction [${evt.tx.header.hash.show}].",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletStateTracer[F] = {
    val eventTracer: Tracer[F, WalletStateEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new WalletStateTracer[F](eventTracer)
  }

}
