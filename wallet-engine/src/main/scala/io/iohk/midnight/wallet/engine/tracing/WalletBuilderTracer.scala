package io.iohk.midnight.wallet.engine.tracing

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderEvent.*

class WalletBuilderTracer[F[_]](val tracer: Tracer[F, WalletBuilderEvent]) {

  def buildRequested(config: Config): F[Unit] = tracer(BuildRequested(config))
  val walletBuildSuccess: F[Unit] = tracer(WalletBuildSuccess)
  def walletBuildError(reason: String): F[Unit] = tracer(WalletBuildError(reason))

}

object WalletBuilderTracer {

  import WalletBuilderEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_builder")

  implicit val txSubmissionEventAsStructuredLog: AsStructuredLog[WalletBuilderEvent] = {
    case e: BuildRequested   => e.asContextAwareLog
    case WalletBuildSuccess  => WalletBuildSuccess.asContextAwareLog
    case e: WalletBuildError => e.asContextAwareLog
  }

  implicit val buildRequestedAsStructuredLog: AsStructuredLog[BuildRequested] =
    AsContextAwareLog.instance(
      id = BuildRequested.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Wallet build has been requested.",
      context = _.stringLogContext,
    )

  implicit val buildSuccessAsStructuredLog: AsStructuredLog[WalletBuildSuccess.type] =
    AsContextAwareLog.instance(
      id = WalletBuildSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Wallet was built successfully.",
      context = _ => StringLogContext.empty,
    )

  implicit val buildErrorAsStructuredLog: AsStructuredLog[WalletBuildError] =
    AsContextAwareLog.instance(
      id = WalletBuildError.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Wallet build failed.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletBuilderTracer[F] = {
    val walletBuilderTracer: Tracer[F, WalletBuilderEvent] =
      structuredTracer >=> (evt => Sync[F].delay(evt.asContextAwareLog))
    new WalletBuilderTracer[F](walletBuilderTracer)
  }

}
