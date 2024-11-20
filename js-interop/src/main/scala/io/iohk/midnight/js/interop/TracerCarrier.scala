package io.iohk.midnight.js.interop

import cats.effect.IO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel, StringLogContext, StructuredLog}

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}

final case class TracerCarrier[T](tracer: Tracer[IO, T])

@JSExportTopLevel("TracerCarrier")
object TracerCarrier {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  @JSExport def createLoggingTracer(logLevel: js.UndefOr[String]): TracerCarrier[StructuredLog] = {
    parseLogLevel(logLevel.toOption) match
      case Left(error)  => throw new Error(error)
      case Right(value) => TracerCarrier(ConsoleTracer.contextAware[IO, StringLogContext](value))
  }

  def parseLogLevel(minLogLevel: Option[String]): Either[String, LogLevel] =
    minLogLevel match {
      case Some(providedLogLevel) =>
        LogLevel
          .fromString(providedLogLevel)
          .toRight(s"Invalid log level: $providedLogLevel")
      case None =>
        Right(LogLevel.Warn)
    }
}
