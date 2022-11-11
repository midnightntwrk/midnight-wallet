package io.iohk.midnight.wallet.core

import cats.effect.{Ref, Temporal}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.services.{SyncService, TxSubmissionService}
import scala.concurrent.duration.DurationInt
import scala.scalajs.js.BigInt
import typings.midnightLedger.mod.ZSwapLocalState

trait Wallet[F[_]] {
  def submitTransaction(transaction: Transaction): F[Hash[Transaction]]

  def balance(): Stream[F, BigInt]

  def sync(): Stream[F, Block]
}

object Wallet {
  class Live[F[_]: Temporal](
      localState: Ref[F, ZSwapLocalState],
      submitTxService: TxSubmissionService[F],
      syncService: SyncService[F],
  ) extends Wallet[F] {
    val Zero: BigInt = BigInt(0)

    override def submitTransaction(transaction: Transaction): F[Hash[Transaction]] =
      for {
        response <- submitTxService.submitTransaction(transaction)
        result <- response match {
          case SubmissionResult.Accepted         => transaction.header.hash.pure
          case SubmissionResult.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result

    override def balance(): Stream[F, BigInt] =
      Stream
        .fixedDelay(1.second)
        .evalMap(_ => localState.get)
        .map(_.coins)
        .map(_.map(_.value))
        .map(_.fold(Zero)(_ + _))

    override def sync(): Stream[F, Block] =
      syncService.sync()
  }

  object Live {
    def apply[F[_]: Temporal](
        submitTxService: TxSubmissionService[F],
        syncService: SyncService[F],
        initialState: ZSwapLocalState = new ZSwapLocalState(),
    ): F[Live[F]] =
      Ref
        .of[F, ZSwapLocalState](initialState)
        .map(new Live[F](_, submitTxService, syncService))
  }

  sealed trait Error extends Exception
  final case class TransactionRejected(reason: String) extends Error // FIXME not an exception
}
