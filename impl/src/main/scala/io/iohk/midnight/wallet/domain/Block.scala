package io.iohk.midnight.wallet.domain

import java.time.Instant

case class Block(header: Block.Header, transactions: Seq[TransactionWithReceipt])

object Block {
  case class Header(
      hash: Hash[Block],
      parentHash: Hash[Block],
      height: Block.Height,
      timestamp: Instant,
  )

  sealed abstract case class Height(value: BigInt)
  object Height {
    def apply(value: BigInt): Either[String, Height] =
      Either.cond(
        value >= 0,
        new Height(value) {},
        s"Block height must be non negative, but was ${value.toString()}",
      )
  }
}
