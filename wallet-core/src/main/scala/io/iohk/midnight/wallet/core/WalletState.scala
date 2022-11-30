package io.iohk.midnight.wallet.core

import cats.effect.kernel.Deferred
import cats.effect.{Ref, Resource, Temporal}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.wallet.core.services.SyncService
import scala.concurrent.duration.DurationInt
import scala.scalajs.js.BigInt
import typings.midnightLedger.mod.{Transaction, ZSwapCoinPublicKey, ZSwapLocalState}

trait WalletState[F[_]] {
  def start(): F[Unit]

  def publicKey(): F[ZSwapCoinPublicKey]

  def balance(): Stream[F, BigInt]

  def localState(): F[ZSwapLocalState]

  def updateLocalState(newState: ZSwapLocalState): F[Unit]
}

object WalletState {
  class Live[F[_]: Temporal](
      localState: Ref[F, ZSwapLocalState],
      syncService: SyncService[F],
      deferred: Deferred[F, Either[Throwable, Unit]],
  ) extends WalletState[F] {
    override def start(): F[Unit] =
      syncService
        .sync()
        .map(_.body.transactionResults)
        .flatMap(Stream.emits)
        .map(LedgerSerialization.fromTransaction)
        .flatMap(Stream.fromEither(_))
        .evalMap { tx =>
          localState.update { state =>
            state.applyLocal(tx)
            state
          }
        }
        .interruptWhen(deferred)
        .compile
        .drain

    override def publicKey(): F[ZSwapCoinPublicKey] =
      localState.get.map(_.coinPublicKey)

    override def balance(): Stream[F, BigInt] =
      Stream
        .fixedDelay(1.second)
        .evalMap(_ => localState.get)
        .map(_.coins)
        .map(_.map(_.value))
        .map(_.combineAll(sum))

    override def localState(): F[ZSwapLocalState] = localState.get

    override def updateLocalState(newState: ZSwapLocalState): F[Unit] =
      localState.set(newState)

    private def stop(): F[Unit] = deferred.complete(Right(())).void
  }

  object Live {
    def apply[F[_]: Temporal](
        syncService: SyncService[F],
        initialState: ZSwapLocalState = new ZSwapLocalState(),
    ): Resource[F, Live[F]] = {
      val wallet = for {
        deferred <- Deferred[F, Either[Throwable, Unit]]
        ref <- Ref.of(initialState)
      } yield new Live[F](ref, syncService, deferred)

      Resource.make(wallet)(_.stop())
    }
  }

  def calculateCost(tx: Transaction): BigInt =
    tx.imbalances().map(_.imbalance).combineAll(sum)
}
