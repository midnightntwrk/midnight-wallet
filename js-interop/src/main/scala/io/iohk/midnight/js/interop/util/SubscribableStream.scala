package io.iohk.midnight.js.interop.util

import cats.Applicative
import cats.effect.Concurrent
import cats.effect.Resource.ExitCase
import cats.syntax.flatMap.*
import fs2.Stream
import fs2.concurrent.SignallingRef

private class SubscribableStream[F[_]: Concurrent, T](stream: Stream[F, T]) {
  def subscribe(observer: StreamObserver[F, T]): Subscription[F] = {
    val signallingRef = SignallingRef.of[F, Boolean](false)

    val start = signallingRef.flatMap { signal =>
      stream
        .evalMapChunk(observer.next)
        .interruptWhen(signal)
        .onFinalizeCase {
          case ExitCase.Succeeded      => observer.complete()
          case ExitCase.Errored(error) => observer.error(error)
          case ExitCase.Canceled       => Applicative[F].unit
        }
        .compile
        .drain
    }

    val cancel = signallingRef.flatMap(_.set(true))

    Subscription(start, cancel)
  }
}
