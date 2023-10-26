package io.iohk.midnight.wallet.core.tracing

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.ViewingUpdate
import io.iohk.midnight.wallet.core.tracing.WalletSyncEvent.*
import io.iohk.midnight.wallet.zswap.Transaction

class WalletSyncTracer[F[_]](
    val tracer: Tracer[F, WalletSyncEvent],
) {
  def handlingUpdate(viewingUpdate: ViewingUpdate): F[Unit] = tracer(
    SyncHandlingUpdate(viewingUpdate),
  )
  def applyUpdateSuccess(viewingUpdate: ViewingUpdate): F[Unit] = tracer(
    ApplyUpdateSuccess(viewingUpdate),
  )
  // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
  def applyUpdateError(viewingUpdate: ViewingUpdate, error: WalletError): F[Unit] = tracer(
    ApplyUpdateError(viewingUpdate, error),
  )
  // $COVERAGE-ON$
}

object WalletSyncTracer {

  import WalletSyncEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_sync")

  implicit val walletSyncEventAsStructuredLog: AsStructuredLog[WalletSyncEvent] = {
    case evt: SyncHandlingUpdate => evt.asContextAwareLog
    case evt: ApplyUpdateSuccess => evt.asContextAwareLog
    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    case evt: ApplyUpdateError => evt.asContextAwareLog
    // $COVERAGE-ON$
  }

  implicit val syncHandlingUpdateAsStructuredLog: AsStructuredLog[SyncHandlingUpdate] =
    AsContextAwareLog.instance(
      id = SyncHandlingUpdate.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt =>
        s"Starting applying update [${evt.update.updates.collect { case Right(tx) => tx }.map(_.hash).mkString("[", ",", "]")}].",
      context = _.stringLogContext,
    )

  implicit val applyUpdateSuccessAsStructuredLog: AsStructuredLog[ApplyUpdateSuccess] =
    AsContextAwareLog.instance(
      id = ApplyUpdateSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt =>
        s"Successfully applied update [${evt.update.updates.collect { case Right(tx) => tx }.map(_.hash).mkString("[", ",", "]")}].",
      context = _.stringLogContext,
    )

  // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
  implicit val applyUpdateErrorAsStructuredLog: AsStructuredLog[ApplyUpdateError] =
    AsContextAwareLog.instance(
      id = ApplyUpdateError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt =>
        s"Error while applying update [${evt.update.updates.collect { case Right(tx) => tx }.map(_.hash).mkString("[", ",", "]")}].",
      context = _.stringLogContext,
    )
  // $COVERAGE-ON$

  def from[F[_]: Sync](structuredTracer: Tracer[F, StructuredLog]): WalletSyncTracer[F] =
    new WalletSyncTracer[F](structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog)))
}
