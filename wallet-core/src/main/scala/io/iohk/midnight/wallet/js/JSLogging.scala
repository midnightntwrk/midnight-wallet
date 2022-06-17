package io.iohk.midnight.wallet.js

import cats.effect.IO
import org.scalajs.dom.console
import org.typelevel.log4cats.Logger

object JSLogging {

  implicit val loggingEv: Logger[IO] = new Logger[IO] {
    override def error(message: => String): IO[Unit] = IO(console.error(message))

    override def warn(message: => String): IO[Unit] = IO(console.warn(message))

    override def info(message: => String): IO[Unit] = IO(console.info(message))

    override def debug(message: => String): IO[Unit] = IO(console.debug(message))

    override def trace(message: => String): IO[Unit] = IO(console.debug(message))

    override def error(t: Throwable)(message: => String): IO[Unit] = IO(console.error(message, t))

    override def warn(t: Throwable)(message: => String): IO[Unit] = IO(console.warn(message, t))

    override def info(t: Throwable)(message: => String): IO[Unit] = IO(console.info(message, t))

    override def debug(t: Throwable)(message: => String): IO[Unit] = IO(console.debug(message, t))

    override def trace(t: Throwable)(message: => String): IO[Unit] = IO(console.debug(message, t))
  }
}
