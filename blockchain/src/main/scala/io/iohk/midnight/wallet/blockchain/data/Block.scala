package io.iohk.midnight.wallet.blockchain.data

import java.time.Instant

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
    val Genesis: Height = new Height(0) {}

    def apply(value: BigInt): Either[String, Height] =
      Either.cond(
        value >= 0,
        new Height(value) {},
        s"Block height must be non negative, but was ${value.toString()}",
      )
  }
}
