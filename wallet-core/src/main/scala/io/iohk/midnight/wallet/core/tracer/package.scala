package io.iohk.midnight.wallet.core

import io.iohk.midnight.tracer.Tracer

package object tracer {
  type ClientRequestResponseTracer[F[_]] = Tracer[F, ClientRequestResponseTrace]
}
