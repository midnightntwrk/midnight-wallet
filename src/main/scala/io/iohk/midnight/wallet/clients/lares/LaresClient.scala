package io.iohk.midnight.wallet.clients.lares

import cats.effect.kernel.Async
import cats.effect.std.Console
import io.iohk.midnight.wallet.clients.JsonRpcClient
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.*
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.Serialization.*
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
    def apply[F[_]: Async: Console](backend: SttpBackend[F, Any], uri: Uri): Live[F] = {
      new Live(new JsonRpcClient[F](backend, uri))
    }
  }
}
