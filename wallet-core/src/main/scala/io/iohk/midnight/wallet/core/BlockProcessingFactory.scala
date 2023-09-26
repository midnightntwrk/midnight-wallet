package io.iohk.midnight.wallet.core

import cats.effect.Async
import cats.syntax.all.*
import fs2.Pipe
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.capabilities.WalletTransactionProcessing
import io.iohk.midnight.wallet.core.domain.TransactionHash
import io.iohk.midnight.wallet.core.tracing.WalletTransactionProcessingTracer

object BlockProcessingFactory {
  def pipe[F[_]: Async, TWallet](walletStateContainer: WalletStateContainer[F, TWallet])(implicit
      walletTransactionProcessing: WalletTransactionProcessing[TWallet, Transaction],
      tracer: WalletTransactionProcessingTracer[F],
  ): Pipe[F, Transaction, Either[WalletError, (AppliedTransaction, TWallet)]] = transactions => {
    transactions
      .map(tx => (tx, TransactionHash(tx.hash.value)))
      .evalTap((_, hash) => tracer.handlingTransaction(hash))
      .evalMap { (tx, hash) =>
        walletStateContainer
          .updateStateEither { wallet =>
            walletTransactionProcessing.applyTransaction(wallet, tx)
          }
          .flatTap {
            case Right(_) => tracer.applyTransactionSuccess(hash)
            // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
            case Left(error) => tracer.applyTransactionError(hash, error)
            // $COVERAGE-ON$
          }
          .fmap(_.fmap((AppliedTransaction(hash), _)))
      }
  }

  final case class AppliedTransaction(hash: TransactionHash)
}
