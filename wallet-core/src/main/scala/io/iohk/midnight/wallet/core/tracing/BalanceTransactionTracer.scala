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
import io.iohk.midnight.wallet.core.{LedgerSerialization, WalletError}
import BalanceTransactionEvent.*
import io.iohk.midnight.wallet.zswap.Transaction

class BalanceTransactionTracer[F[_]](val tracer: Tracer[F, BalanceTransactionEvent]) {

  def balanceTxStart(tx: Transaction): F[Unit] = tracer(
    BalanceTransactionStart(LedgerSerialization.toTransaction(tx)),
  )
  def balanceTxSuccess(tx: Transaction): F[Unit] = tracer(
    BalanceTransactionSuccess(LedgerSerialization.toTransaction(tx)),
  )
  def balanceTxError(tx: Transaction, error: WalletError): F[Unit] = tracer(
    BalanceTransactionError(LedgerSerialization.toTransaction(tx), error),
  )

}

object BalanceTransactionTracer {

  import BalanceTransactionEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("balance_transaction")

  implicit val balanceTxEventAsStructuredLog: AsStructuredLog[BalanceTransactionEvent] = {
    case evt: BalanceTransactionStart   => evt.asContextAwareLog
    case evt: BalanceTransactionSuccess => evt.asContextAwareLog
    case evt: BalanceTransactionError   => evt.asContextAwareLog
  }

  implicit val balanceTxStartAsStructuredLog: AsStructuredLog[BalanceTransactionStart] =
    AsContextAwareLog.from(
      id = BalanceTransactionStart.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Starting to balance transaction [${evt.tx.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val balanceTxSuccessAsStructuredLog: AsStructuredLog[BalanceTransactionSuccess] =
    AsContextAwareLog.from(
      id = BalanceTransactionSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Successfully balanced transaction [${evt.tx.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val balanceTxErrorAsStructuredLog: AsStructuredLog[BalanceTransactionError] =
    AsContextAwareLog.from(
      id = BalanceTransactionError.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Error balancing transaction [${evt.tx.hash.show}].",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): BalanceTransactionTracer[F] = {
    val eventTracer: Tracer[F, BalanceTransactionEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new BalanceTransactionTracer[F](eventTracer)
  }

}
