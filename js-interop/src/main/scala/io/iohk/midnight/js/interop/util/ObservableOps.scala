package io.iohk.midnight.js.interop.util

import cats.effect.unsafe.IORuntime
import cats.effect.{Async, IO}
import fs2.Stream
import io.iohk.midnight.js.interop.rxjs.Observable
import io.iohk.midnight.rxjs.distTypesInternalSubscriberMod.Subscriber
import io.iohk.midnight.rxjs.distTypesInternalTypesMod.{Observer, Unsubscribable}
import io.iohk.midnight.rxjs.mod as rxjs
import io.iohk.midnight.std.Partial

object ObservableOps {
  implicit class FromStream[T](stream: Stream[IO, T])(implicit IORuntime: IORuntime) {
    def unsafeToObservable(): rxjs.Observable_[T] =
      Observable(subscriber => {
        val subscription = fromStream(stream, subscriber)
        subscription.start.unsafeRunAndForget()
        () => subscription.cancel.unsafeRunAndForget()
      })
  }

  private def fromStream[F[_]: Async, T](
      stream: Stream[F, T],
      subscriber: Subscriber[T],
  ): Subscription[F] =
    new SubscribableStream[F, T](stream)
      .subscribe(new StreamObserver[F, T] {
        override def next(value: T): F[Unit] =
          Async[F].delay(subscriber.next(value))
        override def error(error: Throwable): F[Unit] =
          Async[F].delay(subscriber.error(error.getMessage))
        override def complete(): F[Unit] =
          Async[F].delay(subscriber.complete())
      })

  implicit class FromIO[T](io: IO[T])(implicit ioRuntime: IORuntime) {
    def unsafeToObservable(): rxjs.Observable_[T] =
      Observable(subscriber => {
        io.attempt
          .map {
            case Right(t) => subscriber.next(t); subscriber.complete()
            case Left(e)  => subscriber.error(e.getMessage)
          }
          .unsafeRunAndForget()
        () => ()
      })
  }

  implicit class SubscribeableObservable[T](observable: rxjs.Observable_[T]) {
    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    def subscribeWithObserver(observer: Observer[T]): Unsubscribable =
      observable.subscribe(observer.asInstanceOf[Partial[Observer[T]]])
  }
}
