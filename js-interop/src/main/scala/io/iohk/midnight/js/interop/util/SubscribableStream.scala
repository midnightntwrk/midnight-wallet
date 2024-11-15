package io.iohk.midnight.js.interop.util

import cats.Applicative
import cats.effect.IO
import cats.effect.Resource.ExitCase
import fs2.Stream
import fs2.concurrent.SignallingRef

private class SubscribableStream[T](stream: Stream[IO, T]) {
  def subscribe(observer: StreamObserver[T]): Subscription = {
    val signallingRef = SignallingRef.of[IO, Boolean](false)

    val start = signallingRef.flatMap { signal =>
      stream
        .evalMapChunk(observer.next)
        .interruptWhen(signal)
        .onFinalizeCase {
          case ExitCase.Succeeded      => observer.complete()
          case ExitCase.Errored(error) => observer.error(error)
          case ExitCase.Canceled       => Applicative[IO].unit
        }
        .compile
        .drain
    }

    val cancel = signallingRef.flatMap(_.set(true))

    Subscription(start, cancel)
  }
}
