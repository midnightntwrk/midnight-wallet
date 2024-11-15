package io.iohk.midnight.wallet.core.tracing

import cats.effect.{IO, Sync}
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.core.domain.TransactionIdentifier
import io.iohk.midnight.wallet.core.tracing.WalletTxServiceEvent.*

class WalletTxServiceTracer(val tracer: Tracer[IO, WalletTxServiceEvent]) {
  def unprovenTransactionReverted(txId: Option[TransactionIdentifier], error: Throwable): IO[Unit] =
    tracer(UnprovenTransactionReverted(txId, error))
}

object WalletTxServiceTracer {
  import WalletTxServiceEvent.DefaultInstances.*

  private val Component = Event.Component("wallet_tx_service")

  implicit val walletTxServiceEventAsStructuredLog: AsStructuredLog[WalletTxServiceEvent] = {
    case evt: UnprovenTransactionReverted => evt.asContextAwareLog
  }

  implicit val unprovenTxRevertedAsStructuredLog: AsStructuredLog[UnprovenTransactionReverted] =
    AsContextAwareLog.from(
      id = UnprovenTransactionReverted.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt =>
        s"Unproven tx ${evt.txId.fold("empty")(_.txId)} was reverted because of ${evt.error.getMessage}",
      context = _.stringLogContext,
    )

  def from(structuredTracer: Tracer[IO, StructuredLog]): WalletTxServiceTracer = {
    val eventTracer: Tracer[IO, WalletTxServiceEvent] =
      structuredTracer >=> (e => Sync[IO].delay(e.asContextAwareLog))
    new WalletTxServiceTracer(eventTracer)
  }
}
