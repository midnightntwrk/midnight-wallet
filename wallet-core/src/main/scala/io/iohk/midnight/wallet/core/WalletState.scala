package io.iohk.midnight.wallet.core

import cats.effect.{Ref, Temporal}
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
  ) extends WalletState[F] {
    override def start(): F[Unit] =
      syncService
        .sync()
        .map(_.body.transactionResults)
        .flatMap(Stream.emits)
        .map(LedgerSerialization.fromTransaction)
        .flatMap(Stream.fromEither(_))
        .evalMap(tx => localState.update(_.applyLocal(tx)))
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
  }

  object Live {
    def apply[F[_]: Temporal](
        syncService: SyncService[F],
        initialState: ZSwapLocalState = new ZSwapLocalState(),
    ): F[Live[F]] =
      Ref
        .of(initialState)
        .map(new Live(_, syncService))
  }

  def calculateCost(tx: Transaction): BigInt =
    tx.imbalances().map(_.imbalance).combineAll(sum)
}
