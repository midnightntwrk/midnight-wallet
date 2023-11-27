package io.iohk.midnight.wallet.indexer

import cats.effect.std.{Dispatcher, Queue}
import cats.effect.{Async, Resource}
import com.raquo.airstream.core.{EventStream, Observer}
import com.raquo.airstream.ownership.ManualOwner
import fs2.Stream

object EventStreamOps {

  extension [T](eventStream: EventStream[T]) {
    def toStream[F[_]: Async]: Stream[F, T] = {
      for {
        dispatcher <- Stream.resource(Dispatcher.sequential[F])
        queue <- Stream.resource(Resource.make(Queue.unbounded[F, Option[T]])(_.offer(None)))
        stream = Stream.fromQueueNoneTerminated(queue)
        observer <- Stream.eval(
          Async[F].delay(
            Observer[T](element => dispatcher.unsafeRunAndForget(queue.offer(Some(element)))),
          ),
        )
        owner <- Stream.eval(Async[F].delay(new ManualOwner()))
        _ <- Stream.resource(
          Resource.make(Async[F].delay(eventStream.addObserver(observer)(owner)))(subscription =>
            Async[F].delay(subscription.kill()),
          ),
        )
        value <- stream
      } yield value
    }
  }
}
