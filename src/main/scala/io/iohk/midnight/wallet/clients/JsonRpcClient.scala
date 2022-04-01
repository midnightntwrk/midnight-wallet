package io.iohk.midnight.wallet.clients

import cats.effect.Async
import cats.syntax.all.*
import io.circe.generic.auto.exportDecoder
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.clients.JsonRpcClient.*
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcClientErrors.*
import org.typelevel.log4cats.Logger
import sttp.client3.*
import sttp.client3.circe.*
import sttp.model.{StatusCode, Uri}
import scala.annotation.unused
import scala.util.control.NoStackTrace

class JsonRpcClient[F[_]: Async: Logger](backend: SttpBackend[F, Any], uri: Uri) {

  @SuppressWarnings(Array("org.wartremover.warts.ToString")) // FIXME: LLW-163
  def doRequest[Req: JsonRpcEncodableAsMethod: Encoder, Resp: Decoder](req: Req): F[Resp] = {
    val jsonRpcRequest = prepareRequest(req)

    Logger[F].debug(s"==> RPC request: ${jsonRpcRequest.toString}") >>
      emptyRequest
        .body(jsonRpcRequest)
        .post(uri)
        .response(asJsonEither[JsonRpcErrorResponse, JsonRpcResponse[Resp]])
        .send(backend)
        .map(_.body)
        .flatTap(r => Logger[F].debug(s"==> RPC response: ${r.toString}"))
        .flatMap {
          case Left(DeserializationException(body, _)) => DeserializationError(body).raiseError
          case Left(HttpError(body, code))             => ServerError(code, body.error).raiseError
          case Right(resp)                             => resp.result.pure
        }
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
  final case class JsonRpcRequest[T](jsonrpc: String, method: String, params: T, id: Int)
  implicit def jsonRpcRequestEncoder[T](implicit
      @unused ev: Encoder[T],
  ): Encoder[JsonRpcRequest[T]] = deriveEncoder

  final case class JsonRpcResponse[T](jsonrpc: String, result: T, id: Int)
  final case class JsonRpcError(code: Int, message: String, data: Option[String])
  final case class JsonRpcErrorResponse(jsonrpc: String, error: JsonRpcError, id: Int)

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
    final case class DeserializationError(body: String) extends JsonRpcClientError
    final case class ServerError(statusCode: StatusCode, error: JsonRpcError)
        extends JsonRpcClientError
  }

}
