package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.wallet.core.FailingWalletStateContainerStub.error

class FailingWalletStateContainerStub[TWalletState] extends WalletStateContainer[TWalletState] {
  override def subscribe: fs2.Stream[IO, TWalletState] = fs2.Stream.raiseError[IO](error)

  override def updateStateEither[E](
      updater: TWalletState => Either[E, TWalletState],
  ): IO[Either[E, TWalletState]] = IO.raiseError(error)

  override def modifyStateEither[E, Output](
      action: TWalletState => Either[E, (TWalletState, Output)],
  ): IO[Either[E, Output]] = IO.raiseError(error)
}

object FailingWalletStateContainerStub {
  val error: Throwable = new Throwable("Wallet State Syncing Error")
}
