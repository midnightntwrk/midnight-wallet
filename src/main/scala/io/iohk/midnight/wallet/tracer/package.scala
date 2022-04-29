package io.iohk.midnight.wallet

import cats.effect.Sync
import org.typelevel.log4cats.Logger

package object tracer {

  type ClientRequestResponseTracer[F[_]] = Tracer[F, ClientRequestResponseTrace]
  object ClientRequestResponseTracer {
    def apply[F[_]: Sync: Logger](): ClientRequestResponseTracer[F] =
      WalletTracerFactory.loggingTracer
  }

}
