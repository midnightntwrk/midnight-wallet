package io.iohk.midnight.wallet.engine.tracing

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.tracing.JsWalletEvent.*

class JsWalletTracer[F[_]](val tracer: Tracer[F, JsWalletEvent]) {

  def jsWalletBuildRequested(rawConfig: RawConfig): F[Unit] =
    tracer(JsWalletBuildRequested(rawConfig))

  def configConstructed(config: Config): F[Unit] = tracer(ConfigConstructed(config))

  def invalidConfig(t: Throwable): F[Unit] = tracer(InvalidConfig(t.getMessage()))

}

object JsWalletTracer {

  import JsWalletEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("js_wallet")

  implicit val txSubmissionEventAsStructuredLog: AsStructuredLog[JsWalletEvent] = {
    case evt: JsWalletBuildRequested => evt.asContextAwareLog
    case evt: ConfigConstructed      => evt.asContextAwareLog
    case evt: InvalidConfig          => evt.asContextAwareLog
  }

  implicit val jsWalletBuildRequestedAsStructuredLog: AsStructuredLog[JsWalletBuildRequested] =
    AsContextAwareLog.from(
      id = JsWalletBuildRequested.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "JS wallet build has been requested.",
      context = _.stringLogContext,
    )

  implicit val ConfigConstructedAsStructuredLog: AsStructuredLog[ConfigConstructed] =
    AsContextAwareLog.from(
      id = ConfigConstructed.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "JS wallet config has been parsed and created.",
      context = _.stringLogContext,
    )

  implicit val InvalidConfigAsStructuredLog: AsStructuredLog[InvalidConfig] =
    AsContextAwareLog.from(
      id = InvalidConfig.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Error while parsing config for JS wallet.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): JsWalletTracer[F] = {
    val jsWalletTracer: Tracer[F, JsWalletEvent] =
      structuredTracer >=> (evt => Sync[F].delay(evt.asContextAwareLog))
    new JsWalletTracer[F](jsWalletTracer)
  }
}
