package io.iohk.midnight.wallet.core.clients.lares

import cats.effect.kernel.Async
import io.iohk.midnight.wallet.core.clients.JsonRpcClient
import io.iohk.midnight.wallet.core.clients.lares.LaresClientProtocol.*
import io.iohk.midnight.wallet.core.clients.lares.LaresClientProtocol.Serialization.*
import io.iohk.midnight.wallet.core.tracer.ClientRequestResponseTracer
import sttp.client3.SttpBackend
import sttp.model.Uri

trait LaresClient[F[_]] {
  def applyBlockLocally(req: ApplyBlockLocallyRequest): F[ApplyBlockLocallyResponse]
}

object LaresClient {

  class Live[F[_]](rpcClient: JsonRpcClient[F]) extends LaresClient[F] {
    override def applyBlockLocally(req: ApplyBlockLocallyRequest): F[ApplyBlockLocallyResponse] =
      rpcClient.doRequest[ApplyBlockLocallyRequest, ApplyBlockLocallyResponse](req)
  }

  object Live {
    def apply[F[_]: Async: ClientRequestResponseTracer](
        backend: SttpBackend[F, Any],
        uri: Uri,
    ): Live[F] = new Live(new JsonRpcClient[F](backend, uri))
  }
}
