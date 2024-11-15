package io.iohk.midnight.wallet.core

import cats.effect.IO
import fs2.Stream

trait WalletQueryStateService[TWallet] {
  def queryOnce[T](query: TWallet => T): IO[T]
  def queryStream[T](query: TWallet => T): Stream[IO, T]
}

object WalletQueryStateService {
  class Live[TWallet](walletStateContainer: WalletStateContainer[TWallet])
      extends WalletQueryStateService[TWallet] {
    override def queryOnce[T](query: TWallet => T): IO[T] =
      walletStateContainer.subscribe.map(query).head.compile.lastOrError
    override def queryStream[T](query: TWallet => T): Stream[IO, T] =
      walletStateContainer.subscribe.map(wallet => query(wallet))
  }
}
