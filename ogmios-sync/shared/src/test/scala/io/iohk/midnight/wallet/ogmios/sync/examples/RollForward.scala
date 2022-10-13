package io.iohk.midnight.wallet.ogmios.sync.examples

import io.circe.Json
import io.circe.syntax.*
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync

import java.time.Instant

@SuppressWarnings(Array("org.wartremover.warts.Throw"))
object RollForward {

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "RollForward",
      |  "payload": {
      |    "header": {
      |      "hash": "5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38",
      |      "parentHash": "a001ec24fa51f84d828b2ee2ffc071ca7fbad64b7b08ab0c07c09b558c936d7f",
      |      "height": 17019280400900804,
      |      "timestamp": "1969-12-31T23:59:59.999231476Z"
      |    },
      |    "body": {
      |      "transactionResults": [
      |        {
      |          "hash": "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
      |          "timestamp": "1969-12-31T23:59:53.999509747Z",
      |          "type": "Deploy",
      |          "publicOracle": {
      |            "test": 1
      |          },
      |          "transitionFunctionCircuits": ["6232e241fc01f4", "e050935684748401"]
      |        },
      |        {
      |          "hash": "b56301fff26c8bef150180614360257aaa2dfd3ff83c76fbeaf1e800ffd7013e",
      |          "timestamp": "1970-01-01T00:00:05.000338337Z",
      |          "type": "Call",
      |          "address": "Address",
      |          "functionName": "Func",
      |          "proof": "Proof",
      |          "nonce": "Nonce",
      |          "publicTranscript": [{
      |            "functionName": "identity",
      |            "arg": {},
      |            "result": {}
      |          }]
      |        }
      |      ]
      |    }
      |  }
      |}""".stripMargin

  val validObject: LocalBlockSync.Receive.RollForward =
    LocalBlockSync.Receive.RollForward(
      Block(
        Block.Header(
          Hash[Block]("5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38"),
          Hash[Block]("a001ec24fa51f84d828b2ee2ffc071ca7fbad64b7b08ab0c07c09b558c936d7f"),
          Block
            .Height(BigInt("17019280400900804"))
            .getOrElse(throw new Exception("Invalid height")),
          Instant.parse("1969-12-31T23:59:59.999231476Z"),
        ),
        Block.Body(
          Seq(
            DeployTransaction(
              Hash[DeployTransaction](
                "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
              ),
              Instant.parse("1969-12-31T23:59:53.999509747Z"),
              PublicOracle(ArbitraryJson(Json.obj("test" := 1))),
              TransitionFunctionCircuits(Seq("6232e241fc01f4", "e050935684748401")),
            ),
            CallTransaction(
              Hash[CallTransaction](
                "b56301fff26c8bef150180614360257aaa2dfd3ff83c76fbeaf1e800ffd7013e",
              ),
              Instant.parse("1970-01-01T00:00:05.000338337Z"),
              Address("Address"),
              FunctionName("Func"),
              Proof("Proof"),
              Nonce("Nonce"),
              Transcript(
                Seq(
                  Query(
                    FunctionName("identity"),
                    ArbitraryJson(Json.obj()),
                    ArbitraryJson(Json.obj()),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    )
}
