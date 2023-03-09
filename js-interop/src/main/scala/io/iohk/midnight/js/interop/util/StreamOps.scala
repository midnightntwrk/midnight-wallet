package io.iohk.midnight.js.interop.util

import cats.effect.std.{Dispatcher, Queue}
import cats.effect.{Async, Resource}
import fs2.Stream
import fs2.concurrent.SignallingRef
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.rxjs.distTypesInternalTypesMod.Observer
import io.iohk.midnight.rxjs.mod.Observable_

object StreamOps {
  implicit class FromObservable[F[_]: Async, T](observable: Observable_[T]) {

    def toStream(): Resource[F, Stream[F, T]] =
      toObservableProtocolStream().map { stream =>
        stream.collect { case Next(element) => element }
      }

    private[util] def toObservableProtocolStream(): Resource[F, Stream[F, ObservableProtocol[T]]] =
      for {
        interruptSignal <- Resource.eval(SignallingRef.of[F, Boolean](false))
        dispatcher <- Dispatcher.sequential[F]
        queue <- Resource.eval(Queue.unbounded[F, ObservableProtocol[T]])
        observer = {
          def queueOffer(protocolElement: ObservableProtocol[T]): Unit =
            dispatcher.unsafeRunAndForget(queue.offer(protocolElement))

          new Observer[T] {
            override def complete(): Unit = queueOffer(Complete)
            override def error(err: Any): Unit = queueOffer(Error(err))
            override def next(value: T): Unit = queueOffer(Next(value))
          }
        }
        subscribeF = Async[F].delay(observable.subscribeWithObserver(observer))
        subscription <- Resource.eval(subscribeF)
        unsubscribeF = Async[F].delay(subscription.unsubscribe())
        createStreamF = Async[F].delay(
          Stream
            .fromQueueUnterminated(queue)
            .evalTap {
              case Next(_)             => Async[F].unit
              case Complete | Error(_) => interruptSignal.set(true)
            }
            .interruptWhen(interruptSignal),
        )
        stream <- Resource.make(createStreamF)(_ => unsubscribeF)
      } yield stream
  }

  sealed trait ObservableProtocol[+T]
  final case class Next[T](e: T) extends ObservableProtocol[T]
  case object Complete extends ObservableProtocol[Nothing]
  final case class Error(error: Any) extends ObservableProtocol[Nothing]
}
