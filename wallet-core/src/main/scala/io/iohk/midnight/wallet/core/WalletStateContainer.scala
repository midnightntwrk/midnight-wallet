package io.iohk.midnight.wallet.core

import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc

trait WalletStateContainer[TWalletState] {
  def updateStateEither[E](
      updater: TWalletState => Either[E, TWalletState],
  ): IO[Either[E, TWalletState]]
  def modifyStateEither[E, Output](
      action: TWalletState => Either[E, (TWalletState, Output)],
  ): IO[Either[E, Output]]
  def subscribe: fs2.Stream[IO, TWalletState]
}

// TODO: Evaluate in the future if layer around Bloc is useful
object WalletStateContainer {
  class Live[TWalletState](
      bloc: Bloc[TWalletState],
  ) extends WalletStateContainer[TWalletState] {

    override def updateStateEither[E](
        updater: TWalletState => Either[E, TWalletState],
    ): IO[Either[E, TWalletState]] = bloc.updateEither(updater)

    override def modifyStateEither[E, Output](
        action: TWalletState => Either[E, (TWalletState, Output)],
    ): IO[Either[E, Output]] = bloc.modifyEither(action)

    override def subscribe: fs2.Stream[IO, TWalletState] = bloc.subscribe
  }

  object Live {
    def apply[TWalletState](
        initialState: TWalletState,
    ): Resource[IO, Live[TWalletState]] = Bloc(initialState).map(new Live[TWalletState](_))
  }
}
