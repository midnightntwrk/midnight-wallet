package io.iohk.midnight.wallet.ogmios.sync.tracing

import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync

sealed trait OgmiosSyncEvent

object OgmiosSyncEvent {

  /** A request to get the next block has been sent to the Ogmios server/bridge.
    */
  case object NextBlockRequested extends OgmiosSyncEvent

  /** The server responded with a `RollForward` response.
    */
  final case class RollForwardReceived(rollForward: LocalBlockSync.Receive.RollForward)
      extends OgmiosSyncEvent

  /** The server responded with a `RollBackward` response.
    */
  final case class RollBackwardReceived(rollBackward: LocalBlockSync.Receive.RollBackward)
      extends OgmiosSyncEvent

  /** The server responded with a `AwaitReply` response.
    */
  case object AwaitReplyReceived extends OgmiosSyncEvent

}
