package io.iohk.midnight.wallet.ouroboros.tracing

sealed trait OuroborosEvent

object OuroborosEvent {

  /** Indicates that the received message does not conform to the protocol.
    */
  final case class UnexpectedMessage(message: String) extends OuroborosEvent

}
