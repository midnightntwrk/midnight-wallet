package io.iohk.midnight.wallet.ouroboros.tracer

import io.iohk.midnight.tracer.logging.LogLevel.{Debug, Error}
import io.iohk.midnight.tracer.logging.{LogLevel, LoggingTrace}

// [TODO] PM-5039 replace with new events
sealed trait ClientRequestResponseTrace extends LoggingTrace {
  override def level: LogLevel = Debug
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
    override val level: LogLevel = Error
  }
}
