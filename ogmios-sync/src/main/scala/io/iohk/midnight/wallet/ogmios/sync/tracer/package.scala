package io.iohk.midnight.wallet.ogmios.sync

import io.iohk.midnight.tracer.Tracer

package object tracer {
  type ClientRequestResponseTracer[F[_]] = Tracer[F, ClientRequestResponseTrace]
}
