package io.iohk.midnight.wallet.ouroboros.network

import io.circe
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.tracer.logging.AsStringLogContext

sealed trait JsonWebSocketClientEvent

object JsonWebSocketClientEvent {

  final case class RequestSent(jsonMsg: String) extends JsonWebSocketClientEvent
  object RequestSent {
    val id: Event.Id[RequestSent] = Event.Id("request_sent")
  }

  final case class ResponseReceived(jsonMsg: String) extends JsonWebSocketClientEvent
  object ResponseReceived {
    val id: Event.Id[ResponseReceived] = Event.Id("response_received")
  }

  final case class SendFailed(error: Throwable) extends JsonWebSocketClientEvent
  object SendFailed {
    val id: Event.Id[SendFailed] = Event.Id("send_failed")
  }

  final case class DecodingFailed(error: circe.Error) extends JsonWebSocketClientEvent
  object DecodingFailed {
    val id: Event.Id[DecodingFailed] = Event.Id("decoding_failed")
  }

  final case class ReceiveFailed(error: Throwable) extends JsonWebSocketClientEvent
  object ReceiveFailed {
    val id: Event.Id[ReceiveFailed] = Event.Id("receive_failed")
  }

  object DefaultInstances {

    implicit val requestSentContext: AsStringLogContext[RequestSent] =
      AsStringLogContext.fromMap[RequestSent](evt =>
        Map(
          "message" -> evt.jsonMsg,
        ),
      )

    implicit val ResponseReceivedContext: AsStringLogContext[ResponseReceived] =
      AsStringLogContext.fromMap[ResponseReceived](evt =>
        Map(
          "message" -> evt.jsonMsg,
        ),
      )

    implicit val SendFailedContext: AsStringLogContext[SendFailed] =
      AsStringLogContext.fromMap[SendFailed](evt =>
        Map(
          "reason" -> evt.error.getMessage(),
        ),
      )

    implicit val DecodingFailedContext: AsStringLogContext[DecodingFailed] =
      AsStringLogContext.fromMap[DecodingFailed](evt =>
        Map(
          "decoding_error" -> evt.error.getMessage(),
        ),
      )

    implicit val ReceiveFailedContext: AsStringLogContext[ReceiveFailed] =
      AsStringLogContext.fromMap[ReceiveFailed](evt =>
        Map(
          "reason" -> evt.error.getMessage(),
        ),
      )

  }

}
