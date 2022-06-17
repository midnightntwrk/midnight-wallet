package io.iohk.midnight.wallet.domain

import io.circe.Json

final case class PublicTranscript(value: Json) extends AnyVal

object PublicTranscript {
  def fromString(str: String): PublicTranscript =
    PublicTranscript(Json.fromString(str))
}
