package io.iohk.midnight.wallet.ogmios.sync.protocol

import cats.syntax.all.*
import io.circe.Decoder
import io.circe.generic.semiauto.*
import io.iohk.midnight.wallet.blockchain.data.*
import java.time.Instant

private[sync] object Decoders {
  private object Internals {
    implicit def hashDecoder[T]: Decoder[Hash[T]] =
      Decoder[String].map(Hash[T])

    implicit val arbitraryJsonDecoder: Decoder[ArbitraryJson] =
      json => Right(ArbitraryJson(json.value))

    implicit val transactionHeaderDecoder: Decoder[Transaction.Header] =
      deriveDecoder[Transaction.Header]

    implicit val transactionDecoder: Decoder[Transaction] =
      deriveDecoder[Transaction]

    implicit val blockHeightDecoder: Decoder[Block.Height] =
      Decoder[BigInt].emap(Block.Height.apply)

    implicit val blockHeaderDecoder: Decoder[Block.Header] =
      Decoder.instance { c =>
        (
          c.get[Hash[Block]]("hash"),
          c.get[Hash[Block]]("parentHash"),
          c.get[Block.Height]("height"),
          c.get[Instant]("timestamp"),
        ).mapN(Block.Header.apply)
      }

    implicit val blockBodyDecoder: Decoder[Block.Body] =
      Decoder.instance {
        _.get[Seq[Transaction]]("transactionResults")
          .map(Block.Body.apply)
      }

    implicit val blockDecoder: Decoder[Block] =
      Decoder.instance { c =>
        (
          c.get[Block.Header]("header"),
          c.get[Block.Body]("body"),
        ).mapN(Block.apply)
      }

    implicit val awaitReplyDecoder: Decoder[LocalBlockSync.Receive.AwaitReply.type] =
      Decoder.const(LocalBlockSync.Receive.AwaitReply)

    implicit val rollForwardDecoder: Decoder[LocalBlockSync.Receive.RollForward] =
      deriveDecoder

    implicit val rollBackwardDecoder: Decoder[LocalBlockSync.Receive.RollBackward] =
      deriveDecoder

    implicit val intersectFoundDecoder: Decoder[LocalBlockSync.Receive.IntersectFound] =
      deriveDecoder

    implicit val intersectNotFoundDecoder: Decoder[LocalBlockSync.Receive.IntersectNotFound.type] =
      Decoder.const(LocalBlockSync.Receive.IntersectNotFound)
  }

  import Internals.*
  implicit val localBlockSyncDecoder: Decoder[LocalBlockSync.Receive] =
    Decoder
      .instance(_.get[LocalBlockSync.Receive.Type](LocalBlockSync.Receive.Type.Discriminator))
      .flatMap {
        case LocalBlockSync.Receive.Type.AwaitReply =>
          Decoder[LocalBlockSync.Receive.AwaitReply.type].widen
        case LocalBlockSync.Receive.Type.RollForward =>
          Decoder[LocalBlockSync.Receive.RollForward].widen
        case LocalBlockSync.Receive.Type.RollBackward =>
          Decoder[LocalBlockSync.Receive.RollBackward].widen
        case LocalBlockSync.Receive.Type.IntersectFound =>
          Decoder[LocalBlockSync.Receive.IntersectFound].widen
        case LocalBlockSync.Receive.Type.IntersectNotFound =>
          Decoder[LocalBlockSync.Receive.IntersectNotFound.type].widen
      }
}
