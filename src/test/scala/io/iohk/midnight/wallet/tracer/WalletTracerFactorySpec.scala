package io.iohk.midnight.wallet.tracer

import cats.effect.{Deferred, IO, Sync}
import io.iohk.midnight.wallet.util.BetterOutputSuite
import munit.CatsEffectSuite
import org.typelevel.log4cats.Logger

class WalletTracerFactorySpec extends CatsEffectSuite with BetterOutputSuite {

  test("structurizeMessage") {
    val testMsg = "message xyz"
    val testCtx = Map("k1" -> "v1")

    val expected = """{ k1 -> v1, message -> message xyz }"""

    val result = WalletTracerFactory.structurizeMessage(testMsg, testCtx)

    assertEquals(result, expected)
  }

  test("jsLogging tracer") {

    def fakeLogger(promise: Deferred[IO, String]): Logger[IO] = new Logger[IO] {
      override def info(message: => String): IO[Unit] = promise.complete(message).void
      override def error(message: => String): IO[Unit] = ???
      override def warn(message: => String): IO[Unit] = ???
      override def debug(message: => String): IO[Unit] = ???
      override def trace(message: => String): IO[Unit] = ???
      override def error(t: Throwable)(message: => String): IO[Unit] = ???
      override def warn(t: Throwable)(message: => String): IO[Unit] = ???
      override def info(t: Throwable)(message: => String): IO[Unit] = ???
      override def debug(t: Throwable)(message: => String): IO[Unit] = ???
      override def trace(t: Throwable)(message: => String): IO[Unit] = ???
    }

    val testMsg = "message xyz"
    val testCtx = Map("k1" -> "v1")
    val testWalletTrace: WalletTrace = new WalletTrace {
      override def level: WalletTrace.Level = WalletTrace.Level.Info
      override def message: String = testMsg
      override def context: Map[String, String] = testCtx
    }

    for {
      promise <- Deferred[IO, String]
      logger = fakeLogger(promise)
      tracer = WalletTracerFactory.loggingTracer[IO](implicitly[Sync[IO]], logger)
      _ <- tracer.apply(testWalletTrace)
      resp <- promise.get
    } yield assertEquals(resp, WalletTracerFactory.structurizeMessage(testMsg, testCtx))
  }

}
