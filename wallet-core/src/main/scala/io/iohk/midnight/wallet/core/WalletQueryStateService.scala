package io.iohk.midnight.wallet.core

import cats.effect.Async
import fs2.Stream

trait WalletQueryStateService[F[_], TWallet] {
  def queryOnce[T](query: TWallet => T): F[T]
  def queryStream[T](query: TWallet => T): Stream[F, T]
}

object WalletQueryStateService {
  class Live[F[_]: Async, TWallet](walletStateContainer: WalletStateContainer[F, TWallet])
      extends WalletQueryStateService[F, TWallet] {
    override def queryOnce[T](query: TWallet => T): F[T] =
      walletStateContainer.subscribe.map(query).head.compile.lastOrError
    override def queryStream[T](query: TWallet => T): Stream[F, T] =
      walletStateContainer.subscribe.map(wallet => query(wallet))
  }
}
