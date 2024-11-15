package io.iohk.midnight.wallet.engine.tracing

import cats.effect.IO
import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderEvent.*

class WalletBuilderTracer(val tracer: Tracer[IO, WalletBuilderEvent]) {

  def buildRequested(config: Config): IO[Unit] = tracer(BuildRequested(config))
  val walletBuildSuccess: IO[Unit] = tracer(WalletBuildSuccess)
  def walletBuildError(reason: String): IO[Unit] = tracer(WalletBuildError(reason))

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
    AsContextAwareLog.from(
      id = BuildRequested.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Wallet build has been requested.",
      context = _.stringLogContext,
    )

  implicit val buildSuccessAsStructuredLog: AsStructuredLog[WalletBuildSuccess.type] =
    AsContextAwareLog.from(
      id = WalletBuildSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Wallet was built successfully.",
      context = _ => StringLogContext.empty,
    )

  implicit val buildErrorAsStructuredLog: AsStructuredLog[WalletBuildError] =
    AsContextAwareLog.from(
      id = WalletBuildError.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Wallet build failed.",
      context = _.stringLogContext,
    )

  def from(
      structuredTracer: Tracer[IO, StructuredLog],
  ): WalletBuilderTracer = {
    val walletBuilderTracer: Tracer[IO, WalletBuilderEvent] =
      structuredTracer >=> (evt => Sync[IO].delay(evt.asContextAwareLog))
    new WalletBuilderTracer(walletBuilderTracer)
  }

}
