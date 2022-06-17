package io.iohk.midnight.wallet.clients.lares

import cats.derived.auto.eq.*
import cats.effect.IO
import cats.syntax.eq.*
import io.circe.{Json, parser}
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.Serialization.*
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.{
  ApplyBlockLocallyRequest,
  ApplyBlockLocallyResponse,
}
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Block.*
import io.iohk.midnight.wallet.domain.Receipt.Success
import io.iohk.midnight.wallet.tracer.ClientRequestResponseTracer
import io.iohk.midnight.wallet.util.BetterOutputSuite
import io.iohk.midnight.wallet.util.implicits.Equality.*
import java.time.Instant
import munit.CatsEffectSuite
import scala.scalajs.js
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.SttpBackendStub
import sttp.client3.{Request, StringBody}
import sttp.model.Uri.*
import sttp.model.{MediaType, Method}

class LaresClientSpec extends CatsEffectSuite with BetterOutputSuite {

  implicit val catsMonadError: CatsMonadError[IO] = new CatsMonadError[IO]
  implicit val clientTracer: ClientRequestResponseTracer[IO] = Tracer.discardTracer[IO]

  def matchesReq(expectedRequest: String): Request[?, ?] => Boolean =
    req =>
      req.method === Method.POST && req.body === StringBody(
        expectedRequest.filterNot(_.isWhitespace),
        "utf-8",
        MediaType.ApplicationJson,
      )

  def testRequest(
      request: ApplyBlockLocallyRequest,
      encodedRequest: String,
      encodedResponse: String,
      response: ApplyBlockLocallyResponse,
  ): IO[Unit] = {
    val backend =
      SttpBackendStub[IO, Any](catsMonadError)
        .whenRequestMatches(matchesReq(encodedRequest))
        .thenRespond[String](encodedResponse)
    val laresClient = LaresClient.Live[IO](backend, uri"http://test.com")
    assertIO(laresClient.applyBlockLocally(request), response)
  }

  test("applyBlockLocally") {
    val encodedReq =
      """{
        |  "jsonrpc": "2.0",
        |  "method": "applyBlockLocally",
        |  "params": {
        |    "from": "from",
        |    "block": {
        |       "header": {
        |           "blockHash": "blockHash",
        |           "parentBlockHash": "parentBlockHash",
        |           "height": 42,
        |           "timestamp": "1969-12-31T23:59:59.999231476Z"
        |       },
        |       "body": {
        |         "transactionResults": [
        |           {
        |             "kind": "lares",
        |             "transaction": {
        |               "hash": "deployHash",
        |               "timestamp": "1969-12-31T23:59:59.999231476Z",
        |               "contractSource": "contractSource",
        |               "publicState": "publicState",
        |               "transitionFunctionCircuits": {
        |                 "transitionFunctionCircuit1": "transitionFunctionCircuit1Value",
        |                 "transitionFunctionCircuit2": "transitionFunctionCircuit2Value"
        |               },
        |               "type": "deploy"
        |             },
        |             "result": {
        |               "type": "resultType"
        |             }
        |           },
        |           {
        |             "kind": "lares",
        |             "transaction": {
        |               "hash": "callHash",
        |               "nonce": "deadbeef",
        |               "timestamp": "1969-12-31T23:59:59.999231476Z",
        |               "deployTransactionHash": "deployTransactionHash",
        |               "transitionFunction": "transitionFunction",
        |               "proof": "proof",
        |               "publicTranscript": "publicTranscript",
        |               "type": "call"
        |             },
        |             "result": {
        |               "type": "resultType"
        |             }
        |           }
        |         ]
        |       }
        |    }
        |  },
        |  "id": 1
        |}""".stripMargin

    val encodedResp =
      """{
        |  "jsonrpc": "2.0",
        |  "result": {
        |    "events": [
        |      "event1", "event2"
        |    ],
        |    "transactionRequests": []
        |  },
        |  "id": 1
        |}""".stripMargin

    val timestamp = Instant.parse("1969-12-31T23:59:59.999231476Z")

    testRequest(
      request = ApplyBlockLocallyRequest(
        from = UserId("from"),
        block = Block(
          header = Header(
            hash = Some(Hash[Block]("blockHash")),
            parentHash = Hash[Block]("parentBlockHash"),
            height = Height(42).getOrElse(???),
            timestamp = timestamp,
          ),
          transactions = List(
            TransactionWithReceipt(
              transaction = DeployTransaction(
                hash = Some(Hash[DeployTransaction]("deployHash")),
                timestamp = timestamp,
                contractSource = ContractSource("contractSource"),
                publicState = PublicState(Json.fromString("publicState")),
                transitionFunctionCircuits = TransitionFunctionCircuits(
                  Map(
                    "transitionFunctionCircuit1" -> "transitionFunctionCircuit1Value",
                    "transitionFunctionCircuit2" -> "transitionFunctionCircuit2Value",
                  ),
                ),
              ),
              receipt = Success,
            ),
            TransactionWithReceipt(
              transaction = CallTransaction(
                hash = Some(Hash[CallTransaction]("callHash")),
                nonce = Nonce("deadbeef"),
                timestamp = timestamp,
                contractHash = Hash[DeployTransaction]("deployTransactionHash"),
                transitionFunction = TransitionFunction("transitionFunction"),
                proof = Some(Proof("proof")),
                publicTranscript = PublicTranscript(Json.fromString("publicTranscript")),
              ),
              receipt = Success,
            ),
          ),
        ),
      ),
      encodedRequest = encodedReq,
      encodedResponse = encodedResp,
      response = ApplyBlockLocallyResponse(
        events = List(SemanticEvent("event1"), SemanticEvent("event2")),
        transactionRequests = List.empty,
      ),
    )
  }

  test("Decode SemanticEvents") {
    parser
      .parse("""{"int": 1, "object": {"key": {"key": "value"}}, "null": null, "array": ["elem"]}""")
      .flatMap(_.as[SemanticEvent])
      .map { case SemanticEvent(event) =>
        assertEquals(event.selectDynamic[Int]("int"), 1)
        assertEquals(
          event
            .selectDynamic[js.Any]("object")
            .selectDynamic[js.Any]("key")
            .selectDynamic[String]("key"),
          "value",
        )
        assertEquals(Option(event.selectDynamic[js.Any]("null")), None)
        assertEquals(event.selectDynamic[js.Array[String]]("array")(0), "elem")
      }
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private implicit class JsDynamicExtension(value: Any) {
    def selectDynamic[T](key: String): T =
      value.asInstanceOf[js.Dynamic].selectDynamic(key).asInstanceOf[T]
  }
}
