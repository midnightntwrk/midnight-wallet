package io.iohk.midnight.wallet.ouroboros.tx_submission

import cats.{Eq, Show}
import io.circe.Encoder
import io.circe.generic.semiauto.deriveEncoder
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Hash

object TestDomain {
  final case class Transaction(hash: Hash)

  object Transaction {
    implicit val show: Show[Transaction] = Show.show(_.hash.toHexString)
    implicit val encoder: Encoder[Transaction] = deriveEncoder
    implicit val txEq: Eq[Transaction] = Eq.fromUniversalEquals
  }
}
