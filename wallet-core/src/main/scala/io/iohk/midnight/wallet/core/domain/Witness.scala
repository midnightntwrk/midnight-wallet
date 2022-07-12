package io.iohk.midnight.wallet.core.domain

import io.circe.Json

final case class Witness(value: Json) extends AnyVal
