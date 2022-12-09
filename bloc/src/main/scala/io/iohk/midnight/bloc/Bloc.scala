package io.iohk.midnight.bloc

import cats.MonadThrow
import cats.effect.std.AtomicCell
import cats.effect.{Async, Resource}
import cats.syntax.all.*
import fs2.Stream
import fs2.concurrent.Topic

/** BLoC (Business Logic Components) pattern in Scala
  * @tparam F
  *   The effect type
  * @tparam T
  *   The value type
  */
trait Bloc[F[_], T] {

  /** Get a stream that emits an element each time there is an update to the underlying value
    */
  def subscribe: Stream[F, T]

  /** Set some value regardless of the previous one
    * @param t
    *   the new value to set
    * @return
    *   an effect that will set the new value and emit it to subscribers upon execution
    */
  def set(t: T): F[Unit]

  /** Update the previous value
    * @param f
    *   a function that returns a new value depending on the previous one
    * @return
    *   an effect that will update the value and emit it to subscribers upon execution
    */
  def update(f: T => T): F[T]
}

object Bloc {

  /** Implementation of [[Bloc]] using an [[AtomicCell]] to hold the current value plus a [[Topic]]
    * to publish updates
    * @param state
    *   The current value, needed to replay it to new subscribers
    * @param topic
    *   Updates to the value will be published here
    * @tparam F
    *   The effect type
    * @tparam T
    *   The value type
    */
  class Live[F[_]: MonadThrow, T](state: AtomicCell[F, T], topic: Topic[F, T]) extends Bloc[F, T] {
    override val subscribe: Stream[F, T] =
      Stream.eval(state.get) ++ topic.subscribeUnbounded

    override def set(t: T): F[Unit] =
      update(_ => t).void

    override def update(cb: T => T): F[T] =
      state.evalUpdateAndGet { prev =>
        val updated = cb(prev)
        topic
          .publish1(updated)
          .rethrowTopicClosed
          .as(updated)
      }

    val stop: F[Unit] =
      topic.close.rethrowTopicClosed
  }

  def apply[F[_]: Async, T](initialValue: T): Resource[F, Bloc[F, T]] = {
    val atomicCell = AtomicCell[F].of(initialValue)
    val topic = Topic[F, T]
    val bloc = (atomicCell, topic).mapN(new Live[F, T](_, _))
    Resource.make(bloc)(_.stop)
  }

  case object TopicAlreadyClosed extends Throwable("Topic was already closed")
  implicit class RethrowTopicClosed[F[_]: MonadThrow](f: F[Either[Topic.Closed, Unit]]) {
    def rethrowTopicClosed: F[Unit] =
      f.flatMap {
        case Right(t)           => t.pure
        case Left(Topic.Closed) => TopicAlreadyClosed.raiseError
      }
  }
}
