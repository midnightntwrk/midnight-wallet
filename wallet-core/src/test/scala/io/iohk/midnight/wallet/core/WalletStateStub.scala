package io.iohk.midnight.wallet.core

import cats.effect.{IO, Ref}
import cats.syntax.foldable.*
import fs2.Stream
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import scala.scalajs.js
import typings.midnightLedger.mod.{ZSwapCoinPublicKey, ZSwapLocalState}

class WalletStateStub(initialState: ZSwapLocalState = new ZSwapLocalState())
    extends WalletState[IO] {

  private val stateRef =
    Ref.unsafe[IO, ZSwapLocalState](initialState)

  override def start: IO[Unit] =
    IO.unit

  override def publicKey: IO[ZSwapCoinPublicKey] =
    localState.map(_.coinPublicKey)

  override def balance: Stream[IO, js.BigInt] =
    Stream.eval(localState.map(_.coins.map(_.value).combineAll(sum)))

  override def localState: IO[ZSwapLocalState] =
    stateRef.get

  override def updateLocalState(newState: ZSwapLocalState): IO[Unit] =
    stateRef.set(newState)
}
