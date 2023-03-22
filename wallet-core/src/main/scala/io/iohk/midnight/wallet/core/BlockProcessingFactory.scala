package io.iohk.midnight.wallet.core

import cats.effect.Async
import cats.syntax.all.*
import fs2.Pipe
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.blockchain.data.Block.Header
import io.iohk.midnight.wallet.core.capabilities.WalletBlockProcessing
import io.iohk.midnight.wallet.core.tracing.WalletBlockProcessingTracer

object BlockProcessingFactory {
  def pipe[F[_]: Async, TWallet](walletStateContainer: WalletStateContainer[F, TWallet])(implicit
      walletBlockProcessing: WalletBlockProcessing[TWallet, Block],
      tracer: WalletBlockProcessingTracer[F],
  ): Pipe[F, Block, Either[WalletError, (AppliedBlock, TWallet)]] = blocks => {
    blocks
      .evalTap(tracer.handlingBlock)
      .evalMap { block =>
        walletStateContainer
          .updateStateEither { wallet =>
            walletBlockProcessing.applyBlock(wallet, block)
          }
          .flatTap {
            case Right(_)    => tracer.applyBlockSuccess(block)
            case Left(error) => tracer.applyBlockError(block, error)
          }
          .fmap(_.fmap((AppliedBlock(block.header), _)))
      }
  }

  final case class AppliedBlock(header: Header)
}
