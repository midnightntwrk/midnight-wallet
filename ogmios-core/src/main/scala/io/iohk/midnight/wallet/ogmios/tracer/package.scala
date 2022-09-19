package io.iohk.midnight.wallet.ogmios

import io.iohk.midnight.tracer.Tracer

// [TODO] PM-5069 replace with new tracer
package object tracer {
  type ClientRequestResponseTracer[F[_]] = Tracer[F, ClientRequestResponseTrace]
}
