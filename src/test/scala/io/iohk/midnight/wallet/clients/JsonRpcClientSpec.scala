package io.iohk.midnight.wallet.clients

import cats.derived.auto.eq.*
import cats.effect.IO
import cats.syntax.eq.*
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcClientErrors.*
import io.iohk.midnight.wallet.clients.JsonRpcClient.{JsonRpcEncodableAsMethod, JsonRpcError}
import io.iohk.midnight.wallet.clients.JsonRpcClientSpec.TestDomain.*
import io.iohk.midnight.wallet.js.JSLogging.loggingEv
import io.iohk.midnight.wallet.util.BetterOutputSuite
import io.iohk.midnight.wallet.util.implicits.Equality.*
import munit.CatsEffectSuite
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.SttpBackendStub
import sttp.client3.{Request, StringBody}
import sttp.model.Uri.*
import sttp.model.{MediaType, Method, StatusCode}

class JsonRpcClientSpec extends CatsEffectSuite with BetterOutputSuite {

  implicit val catsMonadError: CatsMonadError[IO] = new CatsMonadError[IO]

  test("Should get correct response") {
    val rpcClient = new JsonRpcClient[IO](
      SttpBackendStub[IO, Any](catsMonadError)
        .whenRequestMatches(matchesTestReq)
        .thenRespond[String](testResponse),
      uri = uri"http://test.com",
    )
    assertIO(rpcClient.doRequest(TestRequest(42, "string")), TestResponse(24, "different string"))
  }

  test("Should handle server error (with additional data)") {
    val rpcClient = new JsonRpcClient[IO](
      SttpBackendStub[IO, Any](catsMonadError)
        .whenRequestMatches(matchesTestReq)
        .thenRespond[String](errorResp, StatusCode.InternalServerError),
      uri = uri"http://test.com",
    )

    assertIO(
      interceptIO[ServerError](rpcClient.doRequest(TestRequest(42, "string"))),
      ServerError(StatusCode.InternalServerError, JsonRpcError(1, "error message", Some("data"))),
    )
  }

  test("Should handle server error (without additional data)") {
    val rpcClient = new JsonRpcClient[IO](
      SttpBackendStub[IO, Any](catsMonadError)
        .whenRequestMatches(matchesTestReq)
        .thenRespond[String](errorWithoutDataResp, StatusCode.InternalServerError),
      uri = uri"http://test.com",
    )

    assertIO(
      interceptIO[ServerError](rpcClient.doRequest(TestRequest(42, "string"))),
      ServerError(StatusCode.InternalServerError, JsonRpcError(1, "error message", None)),
    )
  }

  test("Should handle deserialization error") {
    val rpcClient = new JsonRpcClient[IO](
      SttpBackendStub[IO, Any](catsMonadError)
        .whenRequestMatches(matchesTestReq)
        .thenRespond[String]("{}"),
      uri = uri"http://test.com",
    )

    assertIO(
      interceptIO[DeserializationError](rpcClient.doRequest(TestRequest(42, "string"))),
      DeserializationError("{}"),
    )
  }

}

object JsonRpcClientSpec {
  object TestDomain {
    final case class TestRequest(intValue: Int, stringValue: String)
    final case class TestResponse(intValue: Int, stringValue: String)

    implicit val encoder: Encoder[TestRequest] = deriveEncoder
    implicit val reqEncodable: JsonRpcEncodableAsMethod[TestRequest] = () => "test"
    implicit val decoder: Decoder[TestResponse] = deriveDecoder

    val matchesTestReq: Request[?, ?] => Boolean =
      req =>
        req.method === Method.POST && req.body === StringBody(
          testReq.filterNot(_.isWhitespace),
          "utf-8",
          MediaType.ApplicationJson,
        )

    val testReq: String =
      """
        |{
        |  "jsonrpc": "2.0",
        |  "method": "test",
        |  "params": {
        |    "intValue": 42,
        |    "stringValue": "string"
        |  },
        |  "id": 1
        |}
        |""".stripMargin

    val testResponse: String =
      """
        |{
        |  "jsonrpc": "2.0",
        |  "result": {
        |    "intValue": 24,
        |    "stringValue": "different string"
        |  },
        |  "id": 1
        |}
        |""".stripMargin

    val errorResp: String =
      """
        |{
        |  "jsonrpc": "2.0",
        |  "error": {
        |    "code": 1,
        |    "message": "error message",
        |    "data": "data"
        |  },
        |  "id": 1
        |}
        |""".stripMargin

    val errorWithoutDataResp: String =
      """
        |{
        |  "jsonrpc": "2.0",
        |  "error": {
        |    "code": 1,
        |    "message": "error message"
        |  },
        |  "id": 1
        |}
        |""".stripMargin
  }
}
