package io.iohk.midnight.wallet.domain

import io.circe.Json

final case class PublicTranscript(value: Json) extends AnyVal
