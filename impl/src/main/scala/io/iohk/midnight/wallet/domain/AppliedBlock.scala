package io.iohk.midnight.wallet.domain

import io.iohk.midnight.wallet.domain.AppliedBlock.{Body, Header}

import java.time.Instant

case class AppliedBlock(header: Header, body: Body)

object AppliedBlock {
  case class ResultMetadata(`type`: String)
  case class TransactionResult(kind: String, transaction: Transaction, result: ResultMetadata)
  case class Header(
      blockHash: Hash[Block],
      parentBlockHash: Hash[Block],
      height: Block.Height,
      timestamp: Instant,
  )
  case class Body(transactionResults: List[TransactionResult])
}
