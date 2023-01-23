package io.iohk.midnight.wallet.blockchain.util.implicits

import cats.Show

import java.time.Instant

object ShowInstances {
  implicit val instantShow: Show[Instant] = cats.Show.fromToString
}
