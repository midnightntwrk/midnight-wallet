package io.iohk.midnight.wallet.core

import cats.MonadThrow
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.services.{SyncService, TxSubmissionService}

trait Wallet[F[_]] {
  def submitTransaction(transaction: Transaction): F[Hash[Transaction]]

  def sync(): Stream[F, Block]
}

object Wallet {
  class Live[F[_]: MonadThrow](
      submitTxService: TxSubmissionService[F],
      syncService: SyncService[F],
  ) extends Wallet[F] {
    override def submitTransaction(transaction: Transaction): F[Hash[Transaction]] =
      for {
        response <- submitTxService.submitTransaction(transaction)
        result <- response match {
          case SubmissionResult.Accepted         => transaction.header.hash.pure
          case SubmissionResult.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result

    override def sync(): Stream[F, Block] =
      syncService.sync()
  }

  sealed trait Error extends Exception
  final case class TransactionRejected(reason: String) extends Error // FIXME not an exception
}
