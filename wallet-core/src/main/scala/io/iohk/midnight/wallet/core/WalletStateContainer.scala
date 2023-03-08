package io.iohk.midnight.wallet.core

import cats.effect.{Async, Resource}
import io.iohk.midnight.bloc.Bloc

trait WalletStateContainer[F[_], TWalletState] {
  def updateStateEither[E](
      updater: TWalletState => Either[E, TWalletState],
  ): F[Either[E, TWalletState]]
  def modifyStateEither[E, Output](
      action: TWalletState => Either[E, (TWalletState, Output)],
  ): F[Either[E, Output]]
  def subscribe: fs2.Stream[F, TWalletState]
}

// TODO: Evaluate in the future if layer around Bloc is useful
object WalletStateContainer {
  class Live[F[_], TWalletState](
      bloc: Bloc[F, TWalletState],
  ) extends WalletStateContainer[F, TWalletState] {

    override def updateStateEither[E](
        updater: TWalletState => Either[E, TWalletState],
    ): F[Either[E, TWalletState]] = bloc.updateEither(updater)

    override def modifyStateEither[E, Output](
        action: TWalletState => Either[E, (TWalletState, Output)],
    ): F[Either[E, Output]] = bloc.modifyEither(action)

    override def subscribe: fs2.Stream[F, TWalletState] = bloc.subscribe
  }

  object Live {
    def apply[F[_]: Async, TWalletState](
        initialState: TWalletState,
    ): Resource[F, Live[F, TWalletState]] = Bloc(initialState).map(new Live[F, TWalletState](_))
  }
}
