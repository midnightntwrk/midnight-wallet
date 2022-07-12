package io.iohk.midnight.wallet.blockchain.data

import io.circe.Json

final case class PublicTranscript(value: Json) extends AnyVal

object PublicTranscript {
  def fromString(str: String): PublicTranscript =
    PublicTranscript(Json.fromString(str))
}
