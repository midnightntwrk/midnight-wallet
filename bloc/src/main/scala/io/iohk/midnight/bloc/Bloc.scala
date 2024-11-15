package io.iohk.midnight.bloc

import cats.effect.std.Semaphore
import cats.effect.{IO, Ref, Resource}
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.contravariantSemigroupal.*
import cats.syntax.either.*
import cats.syntax.functor.*
import fs2.Stream
import fs2.concurrent.Topic

/** BLoC (Business Logic Components) pattern in Scala
  * @tparam T
  *   The value type
  */
trait Bloc[T] {

  /** Get a stream that emits an element each time there is an update to the underlying value
    */
  def subscribe: Stream[IO, T]

  /** Set some value regardless of the previous one
    * @param t
    *   the new value to set
    * @return
    *   an effect that will set the new value and emit it to subscribers upon execution
    */
  def set(t: T): IO[Unit]

  /** Update the previous value
    * @param f
    *   a function that returns a new value depending on the previous one
    * @return
    *   an effect that will update the value and emit it to subscribers upon execution
    */
  def update(f: T => T): IO[T]

  /** Update the previous value and return it
    *
    * @param f
    *   a function that returns a new value depending on the previous one
    * @return
    *   an effect that will update the value and emit it to subscribers upon execution or return
    *   error
    */
  def updateEither[E](f: T => Either[E, T]): IO[Either[E, T]]

  /** Update the previous value and return output value
    *
    * @param f
    *   a function that returns a new value depending on the previous one
    * @return
    *   an effect that will update the value and emit it to subscribers upon execution or return
    *   error
    */
  def modifyEither[E, Output](f: T => Either[E, (T, Output)]): IO[Either[E, Output]]
}

object Bloc {

  /** Implementation of Bloc using a Ref to hold the current value plus a Topic to publish updates
    * @param state
    *   The current value, needed to replay it to new subscribers
    * @param topic
    *   Updates to the value will be published here
    * @param semaphore
    *   Used internally to make [[subscribe]] and [[update]] operations atomic
    * @tparam T
    *   The value type
    */
  class Live[T](state: Ref[IO, T], topic: Topic[IO, T], semaphore: Semaphore[IO]) extends Bloc[T] {
    override val subscribe: Stream[IO, T] = {
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

    override def set(t: T): IO[Unit] = update(_ => t).void

    override def update(cb: T => T): IO[T] =
      semaphore.permit.surround {
        state
          .updateAndGet(cb)
          .flatTap(topic.publish1(_).rethrowTopicClosed)
      }

    override def updateEither[E](f: T => Either[E, T]): IO[Either[E, T]] = modifyEither(
      f(_).fproduct(identity),
    )

    override def modifyEither[E, Output](f: T => Either[E, (T, Output)]): IO[Either[E, Output]] = {
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

    val stop: IO[Unit] =
      topic.close.rethrowTopicClosed
  }

  def apply[T](initialValue: T): Resource[IO, Bloc[T]] = {
    val ref = Ref[IO].of(initialValue)
    val topic = Topic[IO, T]
    val semaphore = Semaphore[IO](1)
    val bloc = (ref, topic, semaphore).mapN(new Live[T](_, _, _))
    Resource.make(bloc)(_.stop)
  }

  case object TopicAlreadyClosed extends Throwable("Topic was already closed")
  implicit class RethrowTopicClosed(f: IO[Either[Topic.Closed, Unit]]) {
    def rethrowTopicClosed: IO[Unit] =
      f.flatMap {
        case Right(t)           => t.pure
        case Left(Topic.Closed) => TopicAlreadyClosed.raiseError
      }
  }
}
