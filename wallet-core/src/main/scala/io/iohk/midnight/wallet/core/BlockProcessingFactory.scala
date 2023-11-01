package io.iohk.midnight.wallet.core

import cats.effect.Async
import cats.syntax.all.*
import fs2.Pipe
import io.iohk.midnight.wallet.core.capabilities.WalletSync
import io.iohk.midnight.wallet.core.domain.ViewingUpdate
import io.iohk.midnight.wallet.core.tracing.WalletSyncTracer

object BlockProcessingFactory {
  def pipe[F[_]: Async, TWallet](walletStateContainer: WalletStateContainer[F, TWallet])(implicit
      walletSync: WalletSync[TWallet, ViewingUpdate],
      tracer: WalletSyncTracer[F],
  ): Pipe[F, ViewingUpdate, Either[WalletError, (ViewingUpdate, TWallet)]] =
    _.evalTap(tracer.handlingUpdate)
      .evalMap { viewingUpdate =>
        walletStateContainer
          .updateStateEither(walletSync.applyUpdate(_, viewingUpdate))
          .flatTap {
            case Right(_) => tracer.applyUpdateSuccess(viewingUpdate)
            // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
            case Left(error) => tracer.applyUpdateError(viewingUpdate, error)
            // $COVERAGE-ON$
          }
          .fmap(_.fmap((viewingUpdate, _)))
      }
}
