package io.iohk.midnight.wallet.ogmios.sync.tracer

import io.iohk.midnight.tracer.logging.LoggingTrace
import io.iohk.midnight.tracer.logging.LoggingTrace.Level

// TODO: NLLW-361
sealed trait ClientRequestResponseTrace extends LoggingTrace {
  override def level: Level = Level.Debug
}

object ClientRequestResponseTrace {

  final case class ClientRequest(request: String) extends ClientRequestResponseTrace {
    override def message: String = s"Request: $request"
  }

  final case class ClientResponse(response: String) extends ClientRequestResponseTrace {
    override def message: String = s"Response: $response"
  }

  final case class UnexpectedMessage(unexpected: String) extends ClientRequestResponseTrace {
    override val message: String = s"Unexpected message received: $unexpected"
    override val level: Level = Level.Error
  }
}
