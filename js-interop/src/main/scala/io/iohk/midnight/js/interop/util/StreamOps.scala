package io.iohk.midnight.js.interop.util

import cats.effect.std.{Dispatcher, Queue}
import cats.effect.{Async, IO, Resource}
import fs2.Stream
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.rxjs.distTypesInternalTypesMod.Observer
import io.iohk.midnight.rxjs.mod.Observable_

object StreamOps {
  implicit class FromObservable[T](observable: Observable_[T]) {

    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    def toObservableProtocolStream: Resource[IO, Stream[IO, ObservableProtocol[T]]] =
      for {
        dispatcher <- Dispatcher.sequential[IO]
        queue <- Resource.eval(Queue.unbounded[IO, Option[ObservableProtocol[T]]])
        observer = {
          def queueOffer(protocolElement: Option[ObservableProtocol[T]]): Unit =
            dispatcher.unsafeRunAndForget(queue.offer(protocolElement))

          new Observer[T] {
            override def complete(): Unit =
              queueOffer(None)

            override def error(err: Any): Unit = {
              queueOffer(Some(Error(err)))
              queueOffer(None)
            }
            override def next(value: T): Unit =
              queueOffer(Some(Next(value)))
          }
        }
        subscribeF = Async[IO].delay(observable.subscribeWithObserver(observer))
        subscription <- Resource.eval(subscribeF)
        unsubscribeF = Async[IO].delay(subscription.unsubscribe())
        createStreamF = Async[IO].delay(Stream.fromQueueNoneTerminated(queue))
        stream <- Resource.make(createStreamF)(_ => unsubscribeF)
      } yield stream
  }

  sealed trait ObservableProtocol[+T]
  final case class Next[T](e: T) extends ObservableProtocol[T]
  final case class Error(error: Any) extends ObservableProtocol[Nothing]
}
