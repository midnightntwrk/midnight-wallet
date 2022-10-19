package io.iohk.midnight.wallet.ogmios.tx_submission.examples

import io.circe.Json
import io.circe.syntax.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission

object SubmitTx {

  val validJsonCall: String =
    """{
      |  "protocol" : "LocalTxSubmission",
      |  "type" : "SubmitTx",
      |  "payload" : {
      |    "header" : {
      |      "hash" : "3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"
      |    },
      |    "body" : {
      |      "type" : "Call",
      |      "address" : "Address",
      |      "functionName" : "Func",
      |      "proof" : "Proof",
      |      "nonce" : "Nonce",
      |      "publicTranscript" : [
      |        {
      |          "functionName" : "identity",
      |          "arg" : {
      |            "arg1" : "argument"
      |          },
      |          "result" : {
      |            "final" : "success"
      |          }
      |        }
      |      ]
      |    }
      |  }
      |}""".stripMargin

  private val query: Json = Json.obj(
    "functionName" := "identity",
    "arg" := Json.obj("arg1" := "argument"),
    "result" := Json.obj("final" := "success"),
  )
  val validCallTx: Transaction =
    data.Transaction(
      data.Transaction.Header(
        Hash[Transaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      ),
      ArbitraryJson(
        Json.obj(
          "type" := "Call",
          "address" := "Address",
          "functionName" := "Func",
          "proof" := "Proof",
          "nonce" := "Nonce",
          "publicTranscript" := Json.arr(query),
        ),
      ),
    )

  val validCallObject: LocalTxSubmission.Send.SubmitTx =
    LocalTxSubmission.Send.SubmitTx(validCallTx)

  val validJsonDeploy: String =
    """{
      |  "protocol" : "LocalTxSubmission",
      |  "type" : "SubmitTx",
      |  "payload" : {
      |    "header" : {
      |      "hash" : "8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe"
      |    },
      |    "body" : {
      |      "type" : "Deploy",
      |      "publicOracle" : {
      |        "test" : 1
      |      },
      |      "transitionFunctionCircuits" : [
      |        "6232e241fc01f4",
      |        "e050935684748401"
      |      ]
      |    }
      |  }
      |}""".stripMargin

  val validDeployTx: Transaction =
    Transaction(
      Transaction.Header(
        Hash[Transaction](
          "8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe",
        ),
      ),
      ArbitraryJson(
        Json.obj(
          "type" := "Deploy",
          "publicOracle" := Json.obj("test" := 1),
          "transitionFunctionCircuits" := Json.arr(
            "6232e241fc01f4".asJson,
            "e050935684748401".asJson,
          ),
        ),
      ),
    )

  val validDeployObject: LocalTxSubmission.Send.SubmitTx =
    LocalTxSubmission.Send.SubmitTx(validDeployTx)
}
