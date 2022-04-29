package io.iohk.midnight.wallet.tracer

import cats.Applicative
import cats.effect.Sync
import io.iohk.midnight.wallet.tracer.WalletTrace.Level
import org.typelevel.log4cats.Logger

object WalletTracerFactory {

  def structurizeMessage(msg: String, ctx: Map[String, String]): String =
    (ctx + ("message" -> msg)).mkString("{ ", ", ", " }")

  def noOp[F[_]: Applicative, T]: Tracer[F, T] = Tracer.noOpTracer

  def loggingTracer[F[_]: Sync: Logger]: Tracer[F, WalletTrace] = new Tracer[F, WalletTrace] {
    override def apply(log: => WalletTrace): F[Unit] =
      Sync[F].defer {
        val structuredLog = structurizeMessage(log.message, log.context)

        log.level match {
          case Level.Error => Logger[F].error(structuredLog)
          case Level.Warn  => Logger[F].warn(structuredLog)
          case Level.Info  => Logger[F].info(structuredLog)
          case Level.Debug => Logger[F].debug(structuredLog)
          case Level.Trace => Logger[F].trace(structuredLog)
        }
      }
  }
}
