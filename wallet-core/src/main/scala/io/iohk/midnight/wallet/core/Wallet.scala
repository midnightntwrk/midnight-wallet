package io.iohk.midnight.wallet.core

import cats.effect.{Ref, Temporal}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.services.{SyncService, TxSubmissionService}
import scala.concurrent.duration.DurationInt
import scala.scalajs.js.BigInt
import typings.midnightLedger.mod.{
  TransactionIdentifier,
  ZSwapCoinPublicKey,
  ZSwapLocalState,
  Transaction,
}

trait Wallet[F[_]] {
  def submitTransaction(transaction: Transaction): F[TransactionIdentifier]

  def balance(): Stream[F, BigInt]

  def publicKey(): F[ZSwapCoinPublicKey]

  def sync(): Stream[F, Transaction]
}

object Wallet {
  class Live[F[_]: Temporal](
      localState: Ref[F, ZSwapLocalState],
      submitTxService: TxSubmissionService[F],
      syncService: SyncService[F],
  ) extends Wallet[F] {
    val Zero: BigInt = BigInt(0)

    override def submitTransaction(ledgerTx: Transaction): F[TransactionIdentifier] =
      for {
        response <- submitTxService.submitTransaction(LedgerSerialization.toTransaction(ledgerTx))
        result <- response match {
          case SubmissionResult.Accepted =>
            ledgerTx
              .identifiers()
              .headOption
              .fold(NoTransactionIdentifiers.raiseError[F, TransactionIdentifier])(_.pure)
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

    override def publicKey(): F[ZSwapCoinPublicKey] =
      localState.get.map(_.coinPublicKey)

    override def sync(): Stream[F, Transaction] =
      syncService
        .sync()
        .map(_.body.transactionResults)
        .flatMap(Stream.emits)
        .map(LedgerSerialization.fromTransaction)
        .flatMap(Stream.fromEither(_))
  }

  object Live {
    def apply[F[_]: Temporal](
        submitTxService: TxSubmissionService[F],
        syncService: SyncService[F],
        initialState: ZSwapLocalState,
    ): F[Live[F]] =
      Ref
        .of(initialState)
        .map(new Live(_, submitTxService, syncService))
  }

  sealed trait Error extends Exception
  final case class TransactionRejected(reason: String) extends Error // FIXME not an exception
  final case object NoTransactionIdentifiers extends Error
}
