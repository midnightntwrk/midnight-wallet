package io.iohk.midnight.wallet.ogmios.tracing

sealed trait OgmiosEvent

object OgmiosEvent {

  /** Indicates that the received message does not conform to the protocol.
    */
  final case class UnexpectedMessage(message: String) extends OgmiosEvent

}
