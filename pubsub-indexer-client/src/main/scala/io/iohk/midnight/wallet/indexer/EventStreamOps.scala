package io.iohk.midnight.wallet.indexer

import caliban.client.CalibanClientError
import caliban.client.laminext.Subscription
import cats.effect.std.{Dispatcher, Queue}
import cats.effect.{Async, Resource}
import cats.syntax.all.*
import com.raquo.airstream.core.{EventStream, Observer}
import com.raquo.airstream.ownership.{ManualOwner, Owner}
import fs2.Stream

object EventStreamOps {

  extension [T](eventStream: EventStream[T]) {
    def toStream[F[_]: Async]: Stream[F, T] = {
      for {
        dispatcher <- Stream.resource(Dispatcher.sequential[F])
        queue <- Stream.resource(
          Resource.make(Queue.unbounded[F, Option[Either[Throwable, T]]])(_.offer(None)),
        )
        stream = Stream.fromQueueNoneTerminated(queue)
        observer <- Stream.eval(
          Async[F].delay(
            Observer.withRecover[T](
              onNext = element => dispatcher.unsafeRunAndForget(queue.offer(element.asRight.some)),
              onError = { case err => dispatcher.unsafeRunAndForget(queue.offer(err.asLeft.some)) },
            ),
          ),
        )
        owner <- Stream.eval(Async[F].delay(new ManualOwner()))
        _ <- Stream.resource(
          Resource.make(Async[F].delay(eventStream.addObserver(observer)(owner)))(subscription =>
            Async[F].delay(subscription.kill()),
          ),
        )
        value <- stream.rethrow
      } yield value
    }
  }

  extension [F[_]: Async, T](subscriptionResource: Resource[F, Subscription[T]]) {
    def toStream: Stream[F, T] = {
      val resource = for {
        dispatcher <- Dispatcher.sequential[F]
        queue <- Resource.eval(Queue.unbounded[F, Option[Either[Throwable, T]]])
        observer = Observer.withRecover[Either[CalibanClientError, T]](
          onNext = element => dispatcher.unsafeRunAndForget(queue.offer(element.some)),
          onError = { case err =>
            dispatcher.unsafeRunAndForget(queue.offer(err.asLeft.some) >> queue.offer(none))
          },
        )
        subscription <- subscriptionResource
        given Owner = new ManualOwner()
        _ <- Resource.make(Async[F].delay(subscription.received.addObserver(observer)))(s =>
          Async[F].delay(s.kill()),
        )
      } yield Stream.fromQueueNoneTerminated(queue).rethrow

      Stream.resource(resource).flatten
    }
  }
}
