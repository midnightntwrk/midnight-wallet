package io.iohk.midnight.wallet.ogmios.tx_submission.examples

import io.circe.Json
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission

import java.time.Instant

object SubmitTx {

  private val query: Query = Query(
    FunctionName("identity"),
    ArbitraryJson(Json.obj("arg1" -> Json.fromString("argument"))),
    ArbitraryJson(Json.obj("final" -> Json.fromString("success"))),
  )

  val validJsonCall: String =
    """{
      |  "protocol" : "LocalTxSubmission",
      |  "type" : "SubmitTx",
      |  "payload" : {
      |    "type" : "call",
      |    "hash" : "3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1",
      |    "timestamp" : "1969-12-31T23:59:59.999391Z",
      |    "address" : "Address",
      |    "functionName" : "Func",
      |    "proof" : "Proof",
      |    "nonce" : "Nonce",
      |    "publicTranscript" : [
      |      {
      |        "functionName" : "identity",
      |        "arg" : {
      |          "arg1" : "argument"
      |        },
      |        "result" : {
      |          "final" : "success"
      |        }
      |      }
      |    ]
      |  }
      |}""".stripMargin

  val validCallTx: CallTransaction =
    data.CallTransaction(
      Hash[CallTransaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      Instant.parse("1969-12-31T23:59:59.999391Z"),
      Address("Address"),
      FunctionName("Func"),
      Proof("Proof"),
      Nonce("Nonce"),
      Transcript(Seq(query)),
    )

  val validCallObject: LocalTxSubmission.Send.SubmitTx =
    LocalTxSubmission.Send.SubmitTx(validCallTx)

  val validJsonDeploy: String =
    """{
      |  "protocol" : "LocalTxSubmission",
      |  "type" : "SubmitTx",
      |  "payload" : {
      |    "type" : "deploy",
      |    "hash" : "8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe",
      |    "timestamp" : "1969-12-31T23:59:57.999536Z",
      |    "contract" : {
      |      "publicOracle" : {
      |        "transcript" : [
      |          {
      |            "functionName" : "identity",
      |            "arg" : {
      |              "arg1" : "argument"
      |            },
      |            "result" : {
      |              "final" : "success"
      |            }
      |          }
      |        ]
      |      },
      |      "privateOracle" : {
      |        "transcript" : [
      |          {
      |            "functionName" : "identity",
      |            "arg" : {
      |              "arg1" : "argument"
      |            },
      |            "result" : {
      |              "final" : "success"
      |            }
      |          }
      |        ]
      |      }
      |    },
      |    "transitionFunctionCircuits" : [
      |      "6232e241fc01f4",
      |      "e050935684748401"
      |    ]
      |  }
      |}""".stripMargin

  val validDeployTx: DeployTransaction =
    DeployTransaction(
      Hash[DeployTransaction](
        "8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe",
      ),
      Instant.parse("1969-12-31T23:59:57.999536Z"),
      Contract(
        Some(PublicOracle(Transcript(Seq(query)))),
        Some(PrivateOracle(Transcript(Seq(query)))),
      ),
      TransitionFunctionCircuits(Seq("6232e241fc01f4", "e050935684748401")),
    )

  val validDeployObject: LocalTxSubmission.Send.SubmitTx =
    LocalTxSubmission.Send.SubmitTx(validDeployTx)
}
