package io.iohk.midnight.bloc

import cats.effect.{Deferred, IO}
import cats.syntax.parallel.*
import cats.syntax.traverse.*
import munit.CatsEffectSuite

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
        deferred <- Deferred[IO, Unit]
        fiber <- bloc.subscribe.take(5).evalTap(_ => deferred.complete(())).compile.toList.start
        _ <- deferred.get
        _ <- bloc.set(12)
        _ <- bloc.update(_ + 1).void
        _ <- bloc.updateEither(value => Right(value + 1))
        _ <- bloc.modifyEither(value => Right((value + 1, "test")))
        result <- fiber.joinWithNever
      } yield assertEquals(result, List(0, 12, 13, 14, 15))
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
        deferred <- Deferred[IO, Unit]
        fiber <- bloc.subscribe.take(101).evalTap(_ => deferred.complete(())).compile.toList.start
        _ <- deferred.get
        _ <- (1 to 100).toList.traverse(bloc.set).void
        result <- fiber.joinWithNever
      } yield assertEquals(result, (0 to 100).toList)
    }
  }

  test("Update atomically") {
    withBloc { bloc =>
      for {
        deferred <- Deferred[IO, Unit]
        fiber <- bloc.subscribe.take(101).evalTap(_ => deferred.complete(())).compile.toList.start
        _ <- deferred.get
        // Increment 100 times in parallel
        _ <- (1 to 100).toList.parTraverse(_ => bloc.update(_ + 1)).void
        result <- fiber.joinWithNever
      } yield assertEquals(result, (0 to 100).toList)
    }
  }

  test("updateEither atomically") {
    withBloc { bloc =>
      for {
        deferred <- Deferred[IO, Unit]
        fiber <- bloc.subscribe.take(101).evalTap(_ => deferred.complete(())).compile.toList.start
        _ <- deferred.get
        // Increment 100 times in parallel
        _ <- (1 to 100).toList.parTraverse(_ => bloc.updateEither(value => Right(value + 1))).void
        result <- fiber.joinWithNever
      } yield assertEquals(result, (0 to 100).toList)
    }
  }

  test("failed updateEither will not blow up Bloc") {
    withBloc { bloc =>
      for {
        _ <- bloc.updateEither(value => Right(value + 1))
        _ <- bloc.updateEither(_ => Left(new RuntimeException("BUM!"))).attempt
        _ <- bloc.updateEither(value => Right(value + 1))
        result <- bloc.subscribe.head.compile.toList
      } yield assertEquals(result, List(2))
    }
  }

  test("modifyEither atomically") {
    withBloc { bloc =>
      for {
        deferred <- Deferred[IO, Unit]
        fiber <- bloc.subscribe.take(101).evalTap(_ => deferred.complete(())).compile.toList.start
        _ <- deferred.get
        // Increment 100 times in parallel
        outputs <- (1 to 100).toList
          .parTraverse(_ => bloc.modifyEither(value => Right((value + 1, value))))
          .map {
            _.collect { case Right(value) => value }
          }
        result <- fiber.joinWithNever
      } yield {
        assertEquals(result, (0 to 100).toList)
        assertEquals(outputs.toSet, (0 to 99).toSet)
      }
    }
  }

  test("failed modifyEither will not blow up Bloc") {
    withBloc { bloc =>
      for {
        _ <- bloc.modifyEither(value => Right((value + 1, value)))
        _ <- bloc.modifyEither(_ => Left(new RuntimeException("BUM!"))).attempt
        _ <- bloc.modifyEither(value => Right((value + 1, value)))
        result <- bloc.subscribe.head.compile.toList
      } yield assertEquals(result, List(2))
    }
  }

  test("Subscribe in order") {
    withBloc { bloc =>
      for {
        deferred1 <- Deferred[IO, Unit]
        deferred2 <- Deferred[IO, Unit]
        _ <- (1 to 1000).toList.traverse(bloc.set).start
        subscription1 <- bloc.subscribe
          .takeWhile(_ < 1000)
          .evalTap(_ => deferred1.complete(()))
          .compile
          .toList
          .start
        _ <- deferred1.get
        subscription2 <- bloc.subscribe
          .takeWhile(_ < 1000)
          .evalTap(_ => deferred2.complete(()))
          .compile
          .toList
          .start
        _ <- deferred2.get
        subscription3 <- bloc.subscribe.takeWhile(_ < 1000).compile.toList.start
        list1 <- subscription1.joinWithNever
        list2 <- subscription2.joinWithNever
        list3 <- subscription3.joinWithNever
      } yield {
        list1.lazyZip(list1.drop(1)).foreach { case (a, b) => assertEquals(a, b - 1, list1) }
        list2.lazyZip(list2.drop(1)).foreach { case (a, b) => assertEquals(a, b - 1, list2) }
        list3.lazyZip(list3.drop(1)).foreach { case (a, b) => assertEquals(a, b - 1, list3) }
        assert(list1.endsWith(list2))
        assert(list2.endsWith(list3))
      }
    }
  }
}
