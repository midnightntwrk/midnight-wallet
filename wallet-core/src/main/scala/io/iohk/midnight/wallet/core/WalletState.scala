package io.iohk.midnight.wallet.core

import cats.effect.*
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.{Transaction, ZSwapCoinPublicKey, ZSwapLocalState}
import io.iohk.midnight.wallet.core.services.SyncService

import scala.scalajs.js
import io.iohk.midnight.wallet.core.tracing.WalletStateTracer

trait WalletState[F[_]] {
  def start: F[Unit]

  def publicKey: F[ZSwapCoinPublicKey]

  def balance: Stream[F, js.BigInt]

  def localState: F[ZSwapLocalState]

  def updateLocalState(newState: ZSwapLocalState): F[Unit]
}

object WalletState {
  class Live[F[_]: Async](
      bloc: Bloc[F, ZSwapLocalState],
      syncService: SyncService[F],
      deferred: Deferred[F, Either[Throwable, Unit]],
  )(implicit tracer: WalletStateTracer[F])
      extends WalletState[F] {

    override val start: F[Unit] =
      syncService
        .sync()
        .evalTap(tracer.handlingBlock)
        .flatMap(block => Stream.emits(block.body.transactionResults))
        .evalTap(tracer.updateStateStart)
        .flatMap(tx => Stream.fromEither(LedgerSerialization.fromTransaction(tx)))
        .foreach { tx =>
          bloc
            .update { s => s.applyLocal(tx); s }
            .attemptTap {
              case Right(_)    => tracer.updateStateSuccess(tx)
              case Left(error) => tracer.updateStateError(tx, error)
            }
            .void
        }
        .interruptWhen(deferred)
        .compile
        .drain

    override val localState: F[ZSwapLocalState] =
      bloc.subscribe.head.compile.lastOrError

    override val publicKey: F[ZSwapCoinPublicKey] =
      localState.map(_.coinPublicKey)

    override val balance: Stream[F, js.BigInt] =
      bloc.subscribe
        .map(_.coins.map(_.value))
        .map(_.combineAll(sum))

    override def updateLocalState(newState: ZSwapLocalState): F[Unit] =
      bloc.set(newState)

    private val stop: F[Unit] =
      deferred.complete(Right(())).void
  }

  object Live {
    def apply[F[_]: Async](
        syncService: SyncService[F],
        initialState: ZSwapLocalState = new ZSwapLocalState(),
    )(implicit tracer: WalletStateTracer[F]): Resource[F, Live[F]] = {
      val bloc = Bloc(initialState)
      val deferred = Resource.eval(Deferred[F, Either[Throwable, Unit]])
      val walletState = (bloc, deferred).mapN(new Live[F](_, syncService, _))
      walletState.map(_.pure).flatMap(Resource.make(_)(_.stop))
    }
  }

  def calculateCost(tx: Transaction): js.BigInt =
    tx.imbalances().map(_.imbalance).combineAll(sum)
}
