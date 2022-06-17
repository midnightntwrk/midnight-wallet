package io.iohk.midnight.wallet.util

import cats.effect.{IO, Ref}
import munit.CatsEffectSuite

import java.util.concurrent.TimeUnit
import scala.concurrent.duration.FiniteDuration

trait StreamObservableFixtures {
  val events: Seq[Int] = Seq.range(0, 100)
  val error = new RuntimeException("error")
  val stream: fs2.Stream[IO, Int] = fs2.Stream.emits(events)
  val infiniteStream: fs2.Stream[IO, Int] = fs2.Stream.emit(0).repeat
  val errorStream: fs2.Stream[IO, Int] =
    fs2.Stream.emits(events) ++ fs2.Stream.raiseError[IO](error) ++ fs2.Stream.emits(events)
}

class StreamObservableSpec
    extends CatsEffectSuite
    with StreamObservableFixtures
    with BetterOutputSuite {

  test("Run stream until get finished message") {
    (for {
      acc <- Ref.of[IO, Seq[Int]](Seq.empty[Int])
      isFinished <- Ref.of[IO, Boolean](false)
      observable = new StreamObservable[IO, Int](stream)
      Subscription(startConsuming, _) = {
        observable.subscribe(new StreamObserver[IO, Int] {
          override def next(value: Int): IO[Unit] = acc.update(old => old :+ value)

          override def error(error: Throwable): IO[Unit] = ???

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
      observable = new StreamObservable[IO, Int](infiniteStream)
      Subscription(startConsuming, cancellation) = {
        observable.subscribe(new StreamObserver[IO, Int] {
          override def next(value: Int): IO[Unit] = IO.unit

          override def error(error: Throwable): IO[Unit] = ???

          override def complete(): IO[Unit] = isFinished.set(true)
        })
      }
      _ <- startConsuming.race(cancellation.delayBy(FiniteDuration(1, TimeUnit.SECONDS)))
    } yield {
      assertIO(isFinished.get, false)
    }).flatten
  }

  test("Run stream and process error, don't run complete clause") {
    (for {
      errorRef <- Ref.of[IO, Option[Throwable]](None)
      isFinished <- Ref.of[IO, Boolean](false)
      observable = new StreamObservable[IO, Int](errorStream)
      Subscription(startConsuming, _) = {
        observable.subscribe(new StreamObserver[IO, Int] {
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
