package io.iohk.midnight.wallet.core.util

import cats.Applicative
import cats.effect.kernel.Concurrent
import cats.effect.kernel.Resource.ExitCase
import cats.implicits.toFlatMapOps
import fs2.concurrent.SignallingRef

class StreamObservable[F[_]: Concurrent, T](stream: fs2.Stream[F, T]) {

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

final case class Subscription[F[_]](startConsuming: F[Unit], cancellation: F[Unit])

trait StreamObserver[F[_], T] {
  def next(value: T): F[Unit]
  def error(error: Throwable): F[Unit]
  def complete(): F[Unit]
}
