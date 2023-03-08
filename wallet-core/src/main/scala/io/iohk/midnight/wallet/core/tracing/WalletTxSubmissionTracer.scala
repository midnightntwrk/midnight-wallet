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
import WalletTxSubmissionEvent.*
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.midnightLedger.mod.TransactionIdentifier

class WalletTxSubmissionTracer[F[_]](val tracer: Tracer[F, WalletTxSubmissionEvent]) {

  def submitTxStart(ledgerTx: Transaction): F[Unit] =
    tracer(TransactionSubmissionStart(LedgerSerialization.toTransaction(ledgerTx)))

  def txValidationSuccess(ledgerTx: Transaction): F[Unit] =
    tracer(TxValidationSuccess(LedgerSerialization.toTransaction(ledgerTx)))

  def txValidationError(ledgerTx: Transaction, error: Throwable): F[Unit] =
    tracer(TxValidationError(LedgerSerialization.toTransaction(ledgerTx), error))

  def submitTxSuccess(ledgerTx: Transaction, txId: TransactionIdentifier): F[Unit] =
    tracer(
      TransactionSubmissionSuccess(
        LedgerSerialization.toTransaction(ledgerTx),
        LedgerSerialization.serializeIdentifier(txId),
      ),
    )

  def submitTxError(ledgerTx: Transaction, error: Throwable): F[Unit] =
    tracer(TransactionSubmissionError(LedgerSerialization.toTransaction(ledgerTx), error))

}

object WalletTxSubmissionTracer {

  import WalletTxSubmissionEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_tx_submission")

  implicit val walletTxSubmissionEventAsStructuredLog: AsStructuredLog[WalletTxSubmissionEvent] = {
    case evt: TransactionSubmissionStart   => evt.asContextAwareLog
    case evt: TransactionSubmissionSuccess => evt.asContextAwareLog
    case evt: TransactionSubmissionError   => evt.asContextAwareLog
    case evt: TxValidationSuccess          => evt.asContextAwareLog
    case evt: TxValidationError            => evt.asContextAwareLog
  }

  implicit val submitTxStartAsStructuredLog: AsStructuredLog[TransactionSubmissionStart] =
    AsContextAwareLog.instance(
      id = TransactionSubmissionStart.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Starting to submit transaction [${evt.tx.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val submitTxSuccessAsStructuredLog: AsStructuredLog[TransactionSubmissionSuccess] =
    AsContextAwareLog.instance(
      id = TransactionSubmissionSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Transaction [${evt.tx.header.hash.show}] has been submitted successfully.",
      context = _.stringLogContext,
    )

  implicit val submitTxErrorAsStructuredLog: AsStructuredLog[TransactionSubmissionError] =
    AsContextAwareLog.instance(
      id = TransactionSubmissionError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Error while submitting transaction [${evt.tx.header.hash.show}].",
      context = _.stringLogContext,
    )

  implicit val txValidationSuccessAsStructuredLog: AsStructuredLog[TxValidationSuccess] =
    AsContextAwareLog.instance(
      id = TxValidationSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Transaction [${evt.tx.header.hash.show}] validated successfully.",
      context = _.stringLogContext,
    )

  implicit val txValidationErrorAsStructuredLog: AsStructuredLog[TxValidationError] =
    AsContextAwareLog.instance(
      id = TxValidationError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Transaction [${evt.tx.header.hash.show}] is invalid.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletTxSubmissionTracer[F] = {
    val eventTracer: Tracer[F, WalletTxSubmissionEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new WalletTxSubmissionTracer[F](eventTracer)
  }

}
