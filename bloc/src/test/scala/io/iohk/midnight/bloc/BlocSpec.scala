package io.iohk.midnight.bloc

import cats.effect.IO
import cats.syntax.parallel.*
import cats.syntax.traverse.*
import munit.CatsEffectSuite
import scala.concurrent.duration.DurationDouble

class BlocSpec extends CatsEffectSuite {
  def withBloc(theTest: Bloc[IO, Int] => IO[Unit]): IO[Unit] =
    Bloc[IO, Int](0).use(theTest)

  test("Initialize to the correct value") {
    withBloc(_.subscribe.head.compile.lastOrError.assertEquals(0))
  }

  test("Set new value") {
    withBloc { bloc =>
      for {
        _ <- bloc.set(10)
        result <- bloc.subscribe.head.compile.lastOrError
      } yield assertEquals(result, 10)
    }
  }

  test("Propagate new values") {
    withBloc { bloc =>
      for {
        fiber <- bloc.subscribe.take(4).compile.toList.start
        _ <- IO.sleep(100.millis) // If we don't wait, values are set before subscription sees them
        _ <- bloc.set(12)
        _ <- bloc.set(13)
        _ <- bloc.update(_ + 1).void
        result <- fiber.joinWithNever
      } yield assertEquals(result, List(0, 12, 13, 14))
    }
  }

  test("Emit last value on fresh subscription") {
    withBloc { bloc =>
      for {
        _ <- bloc.set(8)
        _ <- bloc.update(_ + 2)
        _ <- bloc.set(13)
        result <- bloc.subscribe.head.compile.toList
      } yield assertEquals(result, List(13))
    }
  }

  test("Defer execution of subscription") {
    withBloc { bloc =>
      val stream = bloc.subscribe
      for {
        _ <- bloc.update(_ + 1)
        _ <- bloc.update(_ + 1)
        _ <- bloc.update(_ + 1)
        result <- stream.head.compile.toList
      } yield assertEquals(result, List(3))
    }
  }

  test("Set in order") {
    withBloc { bloc =>
      for {
        fiber <- bloc.subscribe.take(101).compile.toList.start
        _ <- IO.sleep(100.millis) // If we don't wait, values are set before subscription sees them
        _ <- (1 to 100).toList.traverse(bloc.set).void
        result <- fiber.joinWithNever
      } yield assertEquals(result, (0 to 100).toList)
    }
  }

  test("Update atomically") {
    withBloc { bloc =>
      for {
        fiber <- bloc.subscribe.take(101).compile.toList.start
        _ <- IO.sleep(100.millis)
        // Increment 100 times in parallel
        _ <- (1 to 100).toList.parTraverse(_ => bloc.update(_ + 1)).void
        result <- fiber.joinWithNever
      } yield assertEquals(result, (0 to 100).toList)
    }
  }
}
