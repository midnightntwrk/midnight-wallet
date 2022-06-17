package io.iohk.midnight.wallet.ogmios.sync.protocol

import io.circe.generic.semiauto.*
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import io.iohk.midnight.wallet.domain.Hash
import io.iohk.midnight.wallet.ogmios.core.protocol.MessageProtocol

private[sync] object Encoders {
  private object Internals {
    implicit def hashEncoder[T]: Encoder[Hash[T]] =
      Encoder[String].contramap(_.toHexString)

    implicit val findIntersectEncoder: Encoder[LocalBlockSync.Send.FindIntersect] =
      deriveEncoder[LocalBlockSync.Send.FindIntersect].mapJson(
        _.deepMerge(
          Json.obj(
            LocalBlockSync.Send.Type.Discriminator := LocalBlockSync.Send.Type.FindIntersect.entryName,
          ),
        ),
      )

    implicit val requestNextEncoder: Encoder[LocalBlockSync.Send.RequestNext.type] =
      Encoder.instance(_ =>
        Json.obj(
          LocalBlockSync.Send.Type.Discriminator := LocalBlockSync.Send.Type.RequestNext.entryName,
        ),
      )

    implicit val localBlockSyncDoneEncoder: Encoder[LocalBlockSync.Send.Done.type] =
      Encoder.instance(_ =>
        Json.obj(LocalBlockSync.Send.Type.Discriminator := LocalBlockSync.Send.Type.Done.entryName),
      )
  }

  import Internals.*
  implicit val localBlockSyncEncoder: Encoder[LocalBlockSync.Send] =
    Encoder
      .instance[LocalBlockSync.Send] {
        case findIntersect: LocalBlockSync.Send.FindIntersect =>
          Encoder[LocalBlockSync.Send.FindIntersect].apply(findIntersect)
        case LocalBlockSync.Send.RequestNext =>
          Encoder[LocalBlockSync.Send.RequestNext.type].apply(LocalBlockSync.Send.RequestNext)
        case LocalBlockSync.Send.Done =>
          Encoder[LocalBlockSync.Send.Done.type].apply(LocalBlockSync.Send.Done)
      }
      .mapJson(
        _.deepMerge(
          Json.obj(
            MessageProtocol.Type.Discriminator := MessageProtocol.Type.LocalBlockSync.entryName,
          ),
        ),
      )
}
