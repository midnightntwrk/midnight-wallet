package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.WalletError

sealed trait WalletBlockProcessingEvent

object WalletBlockProcessingEvent {

  final case class BlockProcessingHandlingBlock(block: data.Block)
      extends WalletBlockProcessingEvent

  object BlockProcessingHandlingBlock {
    val id: Event.Id[BlockProcessingHandlingBlock] =
      Event.Id("wallet_block_processing_handling_block")
  }

  final case class ApplyBlockSuccess(block: Block) extends WalletBlockProcessingEvent

  object ApplyBlockSuccess {
    val id: Event.Id[ApplyBlockSuccess] = Event.Id("wallet_apply_block_success")
  }

  final case class ApplyBlockError(block: Block, error: WalletError)
      extends WalletBlockProcessingEvent

  object ApplyBlockError {
    val id: Event.Id[ApplyBlockError] = Event.Id("wallet_apply_block_error")
  }

  object DefaultInstances {
    implicit val blockProcessingHandlingBlockContext
        : AsStringLogContext[BlockProcessingHandlingBlock] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_hash" -> evt.block.header.hash.show,
          "block_parent_hash" -> evt.block.header.parentHash.show,
          "block_height" -> evt.block.header.height.show,
        ),
      )
    implicit val applyBlockSuccessContext: AsStringLogContext[ApplyBlockSuccess] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_hash" -> evt.block.header.hash.show,
          "transactions" -> evt.block.body.transactionResults.map(_.header.hash.show).show,
        ),
      )
    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    implicit val applyBlockErrorContext: AsStringLogContext[ApplyBlockError] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "block_hash" -> evt.block.header.hash.show,
          "transactions" -> evt.block.body.transactionResults.map(_.header.hash.show).show,
          "error" -> evt.error.message,
        ),
      )
    // $COVERAGE-ON$
  }

}
