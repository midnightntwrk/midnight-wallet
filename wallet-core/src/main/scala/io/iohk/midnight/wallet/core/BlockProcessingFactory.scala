package io.iohk.midnight.wallet.core

import cats.effect.Async
import cats.syntax.all.*
import fs2.Pipe
import io.iohk.midnight.wallet.core.capabilities.WalletSync
import io.iohk.midnight.wallet.core.domain.IndexerUpdate
import io.iohk.midnight.wallet.core.tracing.WalletSyncTracer

object BlockProcessingFactory {
  def pipe[F[_]: Async, TWallet](walletStateContainer: WalletStateContainer[F, TWallet])(implicit
      walletSync: WalletSync[TWallet, IndexerUpdate],
      tracer: WalletSyncTracer[F],
  ): Pipe[F, IndexerUpdate, Either[WalletError, (IndexerUpdate, TWallet)]] =
    _.evalTap(tracer.handlingUpdate)
      .evalMap { indexerUpdate =>
        walletStateContainer
          .updateStateEither(walletSync.applyUpdate(_, indexerUpdate))
          .flatTap {
            case Right(_) => tracer.applyUpdateSuccess(indexerUpdate)
            // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
            case Left(error) => tracer.applyUpdateError(indexerUpdate, error)
            // $COVERAGE-ON$
          }
          .fmap(_.fmap((indexerUpdate, _)))
      }
}
