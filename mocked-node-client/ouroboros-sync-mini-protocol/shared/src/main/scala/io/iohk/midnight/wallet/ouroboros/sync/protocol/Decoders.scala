package io.iohk.midnight.wallet.ouroboros.sync.protocol

import cats.syntax.all.*
import io.circe.Decoder
import io.circe.generic.semiauto.*

import scala.annotation.unused

private[sync] object Decoders {
  private object Internals {
    implicit val awaitReplyDecoder: Decoder[LocalBlockSync.Receive.AwaitReply.type] =
      Decoder.const(LocalBlockSync.Receive.AwaitReply)

    implicit def rollForwardDecoder[Block](implicit
        @unused e: Decoder[Block],
    ): Decoder[LocalBlockSync.Receive.RollForward[Block]] =
      deriveDecoder[LocalBlockSync.Receive.RollForward[Block]]

    implicit val rollBackwardDecoder: Decoder[LocalBlockSync.Receive.RollBackward] =
      deriveDecoder[LocalBlockSync.Receive.RollBackward]

    implicit val intersectFoundDecoder: Decoder[LocalBlockSync.Receive.IntersectFound] =
      deriveDecoder[LocalBlockSync.Receive.IntersectFound]

    implicit val intersectNotFoundDecoder: Decoder[LocalBlockSync.Receive.IntersectNotFound.type] =
      Decoder.const(LocalBlockSync.Receive.IntersectNotFound)
  }

  implicit def localBlockSyncDecoder[Block: Decoder]: Decoder[LocalBlockSync.Receive[Block]] = {
    import Internals.*
    Decoder
      .instance(_.get[LocalBlockSync.Receive.Type](LocalBlockSync.Receive.Type.Discriminator))
      .flatMap {
        case LocalBlockSync.Receive.Type.AwaitReply =>
          Decoder[LocalBlockSync.Receive.AwaitReply.type].widen
        case LocalBlockSync.Receive.Type.RollForward =>
          Decoder[LocalBlockSync.Receive.RollForward[Block]].widen
        case LocalBlockSync.Receive.Type.RollBackward =>
          Decoder[LocalBlockSync.Receive.RollBackward].widen
        case LocalBlockSync.Receive.Type.IntersectFound =>
          Decoder[LocalBlockSync.Receive.IntersectFound].widen
        case LocalBlockSync.Receive.Type.IntersectNotFound =>
          Decoder[LocalBlockSync.Receive.IntersectNotFound.type].widen
      }
  }
}
