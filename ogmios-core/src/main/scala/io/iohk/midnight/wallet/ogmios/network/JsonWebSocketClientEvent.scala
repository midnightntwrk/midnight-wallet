package io.iohk.midnight.wallet.ogmios.network

import io.circe

sealed trait JsonWebSocketClientEvent

object JsonWebSocketClientEvent {

  final case class RequestSent(jsonMsg: String) extends JsonWebSocketClientEvent
  final case class ResponseReceived(jsonMsg: String) extends JsonWebSocketClientEvent
  final case class SendFailed(reason: String) extends JsonWebSocketClientEvent
  final case class DecodingFailed(error: circe.Error) extends JsonWebSocketClientEvent
  final case class ReceiveFailed(reason: String) extends JsonWebSocketClientEvent

}
