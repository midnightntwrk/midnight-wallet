package io.iohk.midnight.wallet.indexer

import cats.effect.std.{Dispatcher, Queue}
import cats.effect.{Async, Concurrent, Resource, Sync}
import com.raquo.airstream.core.{EventStream, Observer}
import com.raquo.airstream.ownership.ManualOwner
import fs2.Stream

object EventStreamOps {

  extension [T](eventStream: EventStream[T]) {
    def toStream[F[_]: Concurrent: Async]: Stream[F, T] = {
      for {
        dispatcher <- Stream.resource(Dispatcher.sequential[F])
        queue <- Stream.resource(Resource.make(Queue.unbounded[F, Option[T]])(_.offer(None)))
        stream = Stream.fromQueueNoneTerminated(queue)
        observer <- Stream.eval(
          Sync[F].delay(
            Observer[T](element => dispatcher.unsafeRunAndForget(queue.offer(Some(element)))),
          ),
        )
        owner <- Stream.eval(Sync[F].delay(new ManualOwner()))
        _ <- Stream.resource(
          Resource.make(Sync[F].delay(eventStream.addObserver(observer)(owner)))(subscription =>
            Sync[F].delay(subscription.kill()),
          ),
        )
        value <- stream
      } yield value
    }
  }
}
