package io.iohk.midnight.wallet.ouroboros.sync.protocol

import io.circe.generic.semiauto.*
import io.circe.syntax.*
import io.circe.{Encoder, Json}

private[sync] object Encoders {
  private object Internals {
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

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  implicit val localBlockSyncEncoder: Encoder[LocalBlockSync.Send] = {
    import Internals.*

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
            LocalBlockSync.Protocol.Discriminator := LocalBlockSync.Protocol.Name,
          ),
        ),
      )
  }
}
