package io.iohk.midnight.js.interop.util

import cats.effect.unsafe.IORuntime
import cats.effect.{Async, IO}
import fs2.Stream
import io.iohk.midnight.js.interop.rxjs.Observable
import io.iohk.midnight.rxjs.distTypesInternalSubscriberMod.Subscriber
import io.iohk.midnight.rxjs.distTypesInternalTypesMod.{Observer, Unsubscribable}
import io.iohk.midnight.rxjs.mod.Observable_
import cats.effect.unsafe.implicits.global

object ObservableOps {
  implicit class FromStream[T](stream: Stream[IO, T]) {
    def unsafeToObservable(): Observable_[T] =
      Observable(subscriber => {
        val subscription = fromStream(stream, subscriber)
        subscription.start.unsafeRunAndForget()
        () => subscription.cancel.unsafeRunAndForget()
      })
  }

  private def fromStream[T](
      stream: Stream[IO, T],
      subscriber: Subscriber[T],
  ): Subscription =
    new SubscribableStream[T](stream)
      .subscribe(new StreamObserver[T] {
        override def next(value: T): IO[Unit] =
          Async[IO].delay(subscriber.next(value))
        override def error(error: Throwable): IO[Unit] =
          Async[IO].delay(subscriber.error(error.getMessage))
        override def complete(): IO[Unit] =
          Async[IO].delay(subscriber.complete())
      })

  implicit class FromIO[T](io: IO[T])(implicit ioRuntime: IORuntime) {
    def unsafeToObservable(): Observable_[T] =
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

  implicit class SubscribeableObservable[T](observable: Observable_[T]) {
    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    def subscribeWithObserver(observer: Observer[T]): Unsubscribable =
      observable.subscribe(observer)
  }
}
