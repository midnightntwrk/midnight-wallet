package io.iohk.midnight.wallet.ogmios.tx_submission

import io.iohk.midnight.tracer.Tracer

package object tracer {
  type ClientRequestResponseTracer[F[_]] = Tracer[F, ClientRequestResponseTrace]
}
