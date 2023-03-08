package io.iohk.midnight.wallet.core

import cats.effect.Async
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.capabilities.WalletBlockProcessing
import io.iohk.midnight.wallet.core.tracing.WalletBlockProcessingTracer

object BlockProcessingFactory {
  def pipe[F[_]: Async, TWallet](walletStateContainer: WalletStateContainer[F, TWallet])(implicit
      walletBlockProcessing: WalletBlockProcessing[TWallet, Block],
      tracer: WalletBlockProcessingTracer[F],
  ): fs2.Pipe[F, Block, TWallet] = blocks => {
    blocks
      .evalTap(tracer.handlingBlock)
      .foreach { block =>
        walletStateContainer
          .updateStateEither { wallet =>
            walletBlockProcessing.applyBlock(wallet, block)
          }
          .flatTap {
            case Right(_)    => tracer.applyBlockSuccess(block)
            case Left(error) => tracer.applyBlockError(block, error)
          }
          .void
      }
  }
}
