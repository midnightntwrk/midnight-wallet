package io.iohk.midnight.wallet.blockchain.data

import java.time.Instant
import cats.Show
import cats.syntax.contravariant.*

final case class Block(header: Block.Header, body: Block.Body)

object Block {
  final case class Header(
      hash: Hash[Block],
      parentHash: Hash[Block],
      height: Block.Height,
      timestamp: Instant,
  )

  final case class Body(transactionResults: Seq[Transaction])

  sealed abstract case class Height(value: BigInt) {
    def increment: Height = new Height(value + 1) {}
  }
  object Height {

    implicit val heightShow: Show[Height] = Show[BigInt].contramap(_.value)

    val Genesis: Height = new Height(0) {}

    def apply(value: BigInt): Either[String, Height] =
      Either.cond(
        value >= 0,
        new Height(value) {},
        s"Block height must be non negative, but was ${value.toString()}",
      )
  }
}
