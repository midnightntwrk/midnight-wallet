package io.iohk.midnight.wallet.prover.tracing

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

sealed trait ProverClientEvent

object ProverClientEvent {

  final case class ProvingFailed(message: String) extends ProverClientEvent

  object ProvingFailed {
    val id: Event.Id[ProvingFailed] = Event.Id("prover_client_proving_failed")
  }

  object DefaultInstances {
    implicit val provingFailedContext: AsStringLogContext[ProvingFailed] =
      AsStringLogContext.fromEvent(evt => "error" -> evt.message)
  }
}
