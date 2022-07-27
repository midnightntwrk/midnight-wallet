package io.iohk.midnight.wallet.blockchain.data

import io.circe.Json

final case class PublicState(value: Json) extends AnyVal
