package io.iohk.midnight.wallet.clients.lares

import cats.effect.IO
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.clients.JsonRpcClient
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcEncodableAsMethod
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.{
  ApplyBlockLocallyRequest,
  ApplyBlockLocallyResponse,
}
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.Serialization.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Block.*
import io.iohk.midnight.wallet.domain.Receipt.Success
import munit.CatsEffectSuite
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.SttpBackendStub
import sttp.client3.{Request, StringBody}
import sttp.model.Uri.*
import sttp.model.{MediaType, Method}

import java.time.Instant

class LaresClientSpec extends CatsEffectSuite {

  implicit val catsMonadError: CatsMonadError[IO] = new CatsMonadError[IO]

  def matchesReq(expectedRequest: String): Request[?, ?] => Boolean =
    req =>
      req.method == Method.POST && req.body == StringBody(
        expectedRequest.filterNot(_.isWhitespace),
        "utf-8",
        MediaType.ApplicationJson,
      )

  def testRequest[Req: JsonRpcEncodableAsMethod: Encoder, Resp: Decoder](
      request: Req,
      encodedRequest: String,
      encodedResponse: String,
      response: Resp,
  ) = {
    val rpcClient = new JsonRpcClient[IO](
      SttpBackendStub[IO, Any](catsMonadError)
        .whenRequestMatches(matchesReq(encodedRequest))
        .thenRespond[String](encodedResponse),
      uri = uri"http://test.com",
    )
    assertIO(rpcClient.doRequest[Req, Resp](request), response)
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
        |    ]
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
                publicState = PublicState("publicState"),
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
                publicTranscript = PublicTranscript("publicTranscript"),
              ),
              receipt = Success,
            ),
          ),
        ),
      ),
      encodedRequest = encodedReq,
      encodedResponse = encodedResp,
      response = ApplyBlockLocallyResponse(events =
        List(SemanticEvent("\"event1\""), SemanticEvent("\"event2\"")),
      ),
    )
  }

}
