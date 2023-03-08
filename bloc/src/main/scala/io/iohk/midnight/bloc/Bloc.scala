package io.iohk.midnight.bloc

import cats.MonadThrow
import cats.effect.std.Semaphore
import cats.effect.{Async, Ref, Resource}
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.contravariantSemigroupal.*
import cats.syntax.either.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
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

  /** Update the previous value and return it
    *
    * @param f
    *   a function that returns a new value depending on the previous one
    * @return
    *   an effect that will update the value and emit it to subscribers upon execution or or return
    *   error
    */
  def updateEither[E](f: T => Either[E, T]): F[Either[E, T]]

  /** Update the previous value and return output value
    *
    * @param f
    *   a function that returns a new value depending on the previous one
    * @return
    *   an effect that will update the value and emit it to subscribers upon execution or return
    *   error
    */
  def modifyEither[E, Output](f: T => Either[E, (T, Output)]): F[Either[E, Output]]
}

object Bloc {

  /** Implementation of [[Bloc]] using a [[Ref]] to hold the current value plus a [[Topic]] to
    * publish updates
    * @param state
    *   The current value, needed to replay it to new subscribers
    * @param topic
    *   Updates to the value will be published here
    * @param semaphore
    *   Used internally to make [[subscribe]] and [[update]] operations atomic
    * @tparam F
    *   The effect type
    * @tparam T
    *   The value type
    */
  class Live[F[_]: Async, T](state: Ref[F, T], topic: Topic[F, T], semaphore: Semaphore[F])
      extends Bloc[F, T] {
    override val subscribe: Stream[F, T] = {
      val resource = for {
        _ <- Resource.eval(semaphore.acquire)
        currentState <- Resource.eval(state.get)
        subscription <- topic.subscribeAwaitUnbounded
        _ <- Resource.eval(semaphore.release)
      } yield {
        Stream.emit(currentState) ++ subscription
      }

      Stream.resource(resource).flatten
    }

    override def set(t: T): F[Unit] = update(_ => t).void

    override def update(cb: T => T): F[T] =
      semaphore.permit.surround {
        state
          .updateAndGet(cb)
          .flatTap(topic.publish1(_).rethrowTopicClosed)
      }

    override def updateEither[E](f: T => Either[E, T]): F[Either[E, T]] = modifyEither(
      f(_).fproduct(identity),
    )

    override def modifyEither[E, Output](f: T => Either[E, (T, Output)]): F[Either[E, Output]] = {
      semaphore.permit.surround {
        state.get.flatMap { currentState =>
          f(currentState) match {
            case Left(error) => error.asLeft[Output].pure
            case Right((newState, output)) =>
              state
                .set(newState)
                .as(output.asRight[E])
                .flatTap(_ => topic.publish1(newState).rethrowTopicClosed)
          }
        }
      }
    }

    val stop: F[Unit] =
      topic.close.rethrowTopicClosed
  }

  def apply[F[_]: Async, T](initialValue: T): Resource[F, Bloc[F, T]] = {
    val ref = Ref[F].of(initialValue)
    val topic = Topic[F, T]
    val semaphore = Semaphore[F](1)
    val bloc = (ref, topic, semaphore).mapN(new Live[F, T](_, _, _))
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
