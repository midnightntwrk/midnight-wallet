package io.iohk.midnight.wallet.prover.tracing

import cats.effect.IO
import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.prover.tracing.ProverClientEvent.ProvingFailed

class ProverClientTracer(tracer: Tracer[IO, ProverClientEvent]) {
  def provingFailed(error: String): IO[Unit] =
    tracer(ProvingFailed(error))
}

object ProverClientTracer {
  import ProverClientEvent.DefaultInstances.*

  private val Component = Event.Component("prover_client")

  implicit val proverClientEventAsStructuredLog: AsStructuredLog[ProverClientEvent] = {
    case evt: ProvingFailed => evt.asContextAwareLog
  }

  implicit val provingFailedtAsStructuredLog: AsStructuredLog[ProvingFailed] =
    AsContextAwareLog.from(
      id = ProvingFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => evt.message,
      context = _.stringLogContext,
    )

  def from(structuredTracer: Tracer[IO, StructuredLog]): ProverClientTracer =
    new ProverClientTracer(structuredTracer >=> (e => Sync[IO].delay(e.asContextAwareLog)))
}
