package io.iohk.midnight.wallet.core.util

import cats.Applicative
import cats.effect.Async
import cats.effect.kernel.Concurrent
import cats.effect.kernel.Resource.ExitCase
import cats.implicits.toFlatMapOps
import fs2.Stream
import fs2.concurrent.SignallingRef
import io.iohk.midnight.wallet.core.js.facades.rxjs.Subscriber

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

object Subscription {
  def fromStream[F[_]: Async, T](
      stream: Stream[F, T],
      subscriber: Subscriber[T],
  ): Subscription[F] = {
    // $COVERAGE-OFF$
    new StreamObservable[F, T](stream)
      .subscribe(new StreamObserver[F, T] {
        override def next(value: T): F[Unit] =
          Async[F].delay(subscriber.next(value))
        override def error(error: Throwable): F[Unit] =
          Async[F].delay(subscriber.error(error.getMessage))
        override def complete(): F[Unit] =
          Async[F].delay(subscriber.complete())
      })
    // $COVERAGE-ON$
  }
}

trait StreamObserver[F[_], T] {
  def next(value: T): F[Unit]
  def error(error: Throwable): F[Unit]
  def complete(): F[Unit]
}
