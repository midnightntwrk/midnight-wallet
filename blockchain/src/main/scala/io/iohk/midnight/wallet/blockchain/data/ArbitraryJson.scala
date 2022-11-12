package io.iohk.midnight.wallet.blockchain.data

import io.circe

final case class ArbitraryJson(value: circe.Json) extends AnyVal
