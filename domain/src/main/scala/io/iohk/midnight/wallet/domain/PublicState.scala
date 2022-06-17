package io.iohk.midnight.wallet.domain

import io.circe.Json

final case class PublicState(value: Json) extends AnyVal

object PublicState {
  def fromString(str: String): PublicState =
    PublicState(Json.fromString(str))
}
