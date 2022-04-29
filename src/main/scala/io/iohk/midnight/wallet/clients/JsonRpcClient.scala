package io.iohk.midnight.wallet.clients

import cats.Show
import cats.effect.Async
import cats.syntax.all.*
import io.circe.generic.auto.exportDecoder
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.clients.JsonRpcClient.*
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcClientErrors.*
import io.iohk.midnight.wallet.tracer.{ClientRequestResponseTrace, ClientRequestResponseTracer}
import sttp.client3.*
import sttp.client3.circe.*
import sttp.model.{StatusCode, Uri}
import io.iohk.midnight.wallet.clients.JsonRpcClient.showResponseException

import scala.annotation.unused
import scala.util.control.NoStackTrace

class JsonRpcClient[F[_]: Async](backend: SttpBackend[F, Any], uri: Uri)(implicit
    tracer: ClientRequestResponseTracer[F],
) {

  def doRequest[Req: JsonRpcEncodableAsMethod: Encoder, Resp: Decoder](req: Req): F[Resp] = {
    val jsonRpcRequest = prepareRequest(req)

    tracer(ClientRequestResponseTrace.ClientRequest(jsonRpcRequest.show)) >>
      emptyRequest
        .body(jsonRpcRequest)
        .post(uri)
        .response(asJsonEither[JsonRpcErrorResponse, JsonRpcResponse[Resp]])
        .send(backend)
        .map(_.body)
        .flatTap(resp => tracer(ClientRequestResponseTrace.ClientResponse(resp.show)))
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
  object JsonRpcRequest {
    implicit def showJsonRpcRequest[T]: Show[JsonRpcRequest[T]] = Show.fromToString
  }

  implicit def jsonRpcRequestEncoder[T](implicit
      @unused ev: Encoder[T],
  ): Encoder[JsonRpcRequest[T]] = deriveEncoder

  final case class JsonRpcResponse[T](jsonrpc: String, result: T, id: Int)
  object JsonRpcResponse {
    implicit def showJsonRpcResponse[T]: Show[JsonRpcResponse[T]] = Show.fromToString
  }

  final case class JsonRpcError(code: Int, message: String, data: Option[String])
  final case class JsonRpcErrorResponse(jsonrpc: String, error: JsonRpcError, id: Int)

  implicit def showResponseException[T1, T2]: Show[ResponseException[T1, T2]] =
    Show.show(_.getMessage)

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
