package io.iohk.midnight.wallet.indexer

import caliban.client.CalibanClientError
import caliban.client.laminext.Subscription
import cats.effect.std.{Dispatcher, Queue}
import cats.effect.{Async, IO, Resource}
import cats.syntax.all.*
import com.raquo.airstream.core.{EventStream, Observer}
import com.raquo.airstream.ownership.{ManualOwner, Owner}
import fs2.Stream

object EventStreamOps {

  extension [T](eventStream: EventStream[T]) {
    def toStream: Stream[IO, T] = {
      for {
        dispatcher <- Stream.resource(Dispatcher.sequential[IO])
        queue <- Stream.resource(
          Resource.make(Queue.unbounded[IO, Option[Either[Throwable, T]]])(_.offer(None)),
        )
        stream = Stream.fromQueueNoneTerminated(queue)
        observer <- Stream.eval(
          Async[IO].delay(
            Observer.withRecover[T](
              onNext = element => dispatcher.unsafeRunAndForget(queue.offer(element.asRight.some)),
              onError = { case err => dispatcher.unsafeRunAndForget(queue.offer(err.asLeft.some)) },
            ),
          ),
        )
        owner <- Stream.eval(Async[IO].delay(new ManualOwner()))
        _ <- Stream.resource(
          Resource.make(Async[IO].delay(eventStream.addObserver(observer)(owner)))(subscription =>
            Async[IO].delay(subscription.kill()),
          ),
        )
        value <- stream.rethrow
      } yield value
    }
  }

  extension [T](subscriptionResource: Resource[IO, Subscription[T]]) {
    def toStream: Stream[IO, T] = {
      val resource = for {
        dispatcher <- Dispatcher.sequential[IO]
        queue <- Resource.eval(Queue.unbounded[IO, Option[Either[Throwable, T]]])
        observer = Observer.withRecover[Either[CalibanClientError, T]](
          onNext = element => dispatcher.unsafeRunAndForget(queue.offer(element.some)),
          onError = { case err =>
            dispatcher.unsafeRunAndForget(queue.offer(err.asLeft.some) >> queue.offer(none))
          },
        )
        subscription <- subscriptionResource
        given Owner = new ManualOwner()
        _ <- Resource.make(Async[IO].delay(subscription.received.addObserver(observer)))(s =>
          Async[IO].delay(s.kill()),
        )
      } yield Stream.fromQueueNoneTerminated(queue).rethrow

      Stream.resource(resource).flatten
    }
  }
}
