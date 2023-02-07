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
import io.iohk.midnight.midnightLedger.mod.Transaction
import WalletFilterEvent.*
import io.iohk.midnight.wallet.core.LedgerSerialization

class WalletFilterTracer[F[_]](val tracer: Tracer[F, WalletFilterEvent]) {
  def txFilterApplied(tx: Transaction, filterMatched: Boolean): F[Unit] = tracer(
    TxFilterApplied(
      LedgerSerialization.toTransaction(tx),
      filterMatched,
    ),
  )
}

object WalletFilterTracer {

  import WalletFilterEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_tx_filter")

  implicit val walletFilterEventAsStructuredLog: AsStructuredLog[WalletFilterEvent] = {
    case evt: TxFilterApplied => evt.asContextAwareLog
  }

  implicit val txFilterAppliedAsStructuredLog: AsStructuredLog[TxFilterApplied] =
    AsContextAwareLog.instance(
      id = TxFilterApplied.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt =>
        s"Applied filter to transaction [${evt.tx.header.hash.show}]. Match: [${evt.filterMatched.show}]",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletFilterTracer[F] = {
    val eventTracer: Tracer[F, WalletFilterEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new WalletFilterTracer[F](eventTracer)
  }

}
