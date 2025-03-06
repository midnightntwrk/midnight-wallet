package io.iohk.midnight.js.interop.util

import cats.effect.{IO, Ref}
import fs2.Stream
import munit.CatsEffectSuite
import scala.concurrent.duration.DurationInt

trait StreamObservableFixtures {
  val events: Seq[Int] = Seq.range(0, 100)
  val error = new RuntimeException("error")
  val stream: Stream[IO, Int] = Stream.emits(events)
  val infiniteStream: Stream[IO, Int] = Stream.emit(0).repeat

  // Change from val to lazy val to defer evaluation:
  lazy val errorStream: Stream[IO, Int] =
    Stream.emits(events) ++ Stream.raiseError[IO](error) ++ Stream.emits(events)
}

class StreamObservableSpec extends CatsEffectSuite with StreamObservableFixtures {

  test("Run stream until get finished message") {
    (for {
      acc <- Ref.of[IO, Seq[Int]](Seq.empty[Int])
      isFinished <- Ref.of[IO, Boolean](false)
      observable = new SubscribableStream[Int](stream)
      Subscription(startConsuming, _) = {
        observable.subscribe(new StreamObserver[Int] {
          override def next(value: Int): IO[Unit] = acc.update(_ :+ value)
          override def error(error: Throwable): IO[Unit] = IO.unit
          override def complete(): IO[Unit] = isFinished.set(true)
        })
      }
      _ <- startConsuming
    } yield {
      assertIO(acc.get, events) >> assertIO(isFinished.get, true)
    }).flatten
  }

  test("Run stream and cancel it before stream finished") {
    (for {
      isFinished <- Ref.of[IO, Boolean](false)
      observable = new SubscribableStream[Int](infiniteStream)
      Subscription(startConsuming, cancellation) = {
        observable.subscribe(new StreamObserver[Int] {
          override def next(value: Int): IO[Unit] = IO.unit
          override def error(error: Throwable): IO[Unit] = IO.unit
          override def complete(): IO[Unit] = isFinished.set(true)
        })
      }
      _ <- startConsuming.race(cancellation.delayBy(1.second))
    } yield {
      assertIO(isFinished.get, false)
    }).flatten
  }

  test("Run stream and process error, don't run complete clause") {
    (for {
      errorRef <- Ref.of[IO, Option[Throwable]](None)
      isFinished <- Ref.of[IO, Boolean](false)
      observable = new SubscribableStream[Int](errorStream)
      Subscription(startConsuming, _) = {
        observable.subscribe(new StreamObserver[Int] {
          override def next(value: Int): IO[Unit] = IO.unit
          override def error(error: Throwable): IO[Unit] = errorRef.set(Some(error))
          override def complete(): IO[Unit] = isFinished.set(true)
        })
      }
      _ <- startConsuming.attempt
    } yield {
      assertIO(isFinished.get, false) >> assertIO(errorRef.get, Some(error))
    }).flatten
  }
}
