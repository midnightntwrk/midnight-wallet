package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.wallet.core.FailingWalletStateStub.error
import typings.midnightLedger.mod.{ZSwapCoinPublicKey, ZSwapLocalState}

import scala.scalajs.js

class FailingWalletStateStub() extends WalletState[IO] {
  override def start(): IO[Unit] = IO.raiseError(error)

  override def publicKey(): IO[ZSwapCoinPublicKey] = IO.raiseError(error)

  override def balance(): fs2.Stream[IO, js.BigInt] = fs2.Stream.raiseError[IO](error)

  override def localState(): IO[ZSwapLocalState] = IO.raiseError(error)

  override def updateLocalState(newState: ZSwapLocalState): IO[Unit] = IO.raiseError(error)
}

object FailingWalletStateStub {
  val error: Throwable = new Throwable("Wallet State Error")
}
