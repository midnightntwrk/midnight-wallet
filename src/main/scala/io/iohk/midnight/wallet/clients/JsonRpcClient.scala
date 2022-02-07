package io.iohk.midnight.wallet.clients

import cats.effect.Async
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import io.circe.generic.auto.exportDecoder
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.clients.JsonRpcClient.*
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcClientErrors.*
import sttp.client3.*
import sttp.client3.circe.*
import sttp.client3.impl.cats.implicits.monadError
import sttp.model.{StatusCode, Uri}
import sttp.monad.syntax.MonadErrorOps

import scala.annotation.unused
import scala.util.control.NoStackTrace

class JsonRpcClient[F[_]: Async](backend: SttpBackend[F, Any], uri: Uri) {

  def doRequest[Req: JsonRpcEncodableAsMethod: Encoder, Resp: Decoder](req: Req): F[Resp] =
    emptyRequest
      .body(prepareRequest(req))
      .post(uri)
      .response(asJsonEither[JsonRpcErrorResponse, JsonRpcResponse[Resp]])
      .send(backend)
      .map(_.body)
      .flatMap {
        case Left(DeserializationException(body, _)) => DeserializationError(body).raiseError
        case Left(HttpError(body, code))             => ServerError(code, body.error).raiseError
        case Right(resp)                             => resp.result.pure
      }

  private def prepareRequest[Req: JsonRpcEncodableAsMethod](req: Req): JsonRpcRequest[Req] =
    JsonRpcRequest(
      jsonrpc = "2.0",
      method = JsonRpcEncodableAsMethod[Req].method(),
      id = 1, // FIXME
      params = req,
    )

}

object JsonRpcClient {
  case class JsonRpcRequest[T](jsonrpc: String, method: String, params: T, id: Int)
  implicit def jsonRpcRequestEncoder[T](implicit
      @unused ev: Encoder[T],
  ): Encoder[JsonRpcRequest[T]] = deriveEncoder

  case class JsonRpcResponse[T](jsonrpc: String, result: T, id: Int)
  case class JsonRpcError(code: Int, message: String, data: Option[String])
  case class JsonRpcErrorResponse(jsonrpc: String, error: JsonRpcError, id: Int)

  implicit val jsonRpcErrorDecoder: Decoder[JsonRpcError] = deriveDecoder
  implicit def jsonRpcResponseDecoder[T](implicit
      @unused ev: Decoder[T],
  ): Decoder[JsonRpcResponse[T]] = deriveDecoder

  trait JsonRpcEncodableAsMethod[T] {
    def method(): String
  }

  object JsonRpcEncodableAsMethod {
    def apply[T](implicit ev: JsonRpcEncodableAsMethod[T]): JsonRpcEncodableAsMethod[T] = ev
  }

  sealed trait JsonRpcClientError extends NoStackTrace
  object JsonRpcClientErrors {
    case class DeserializationError(body: String) extends JsonRpcClientError
    case class ServerError(statusCode: StatusCode, error: JsonRpcError) extends JsonRpcClientError
  }

}
