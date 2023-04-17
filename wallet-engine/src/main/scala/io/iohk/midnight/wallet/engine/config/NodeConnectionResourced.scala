package io.iohk.midnight.wallet.engine.config

import cats.effect.Resource
import cats.effect.kernel.Async
import io.iohk.midnight.wallet.engine.js.{NodeConnection, SubmitSession, SyncSession}

trait NodeConnectionResourced {
  def syncSessionResource[F[_]: Async]: Resource[F, SyncSession]
  def submitSessionResource[F[_]: Async]: Resource[F, SubmitSession]
}

object NodeConnectionResourced {
  def apply(jsNodeConnection: NodeConnection): NodeConnectionResourced =
    new NodeConnectionResourced {
      override def syncSessionResource[F[_]: Async]: Resource[F, SyncSession] =
        Resource.make(
          Async[F].fromPromise(Async[F].delay(jsNodeConnection.startSyncSession())),
        )(session => Async[F].delay(session.close()))

      override def submitSessionResource[F[_]: Async]: Resource[F, SubmitSession] =
        Resource.make(Async[F].fromPromise(Async[F].delay(jsNodeConnection.startSubmitSession())))(
          session => Async[F].delay(session.close()),
        )
    }
}
