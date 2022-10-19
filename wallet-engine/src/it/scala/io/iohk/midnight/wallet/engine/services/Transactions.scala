package io.iohk.midnight.wallet.engine.services

import io.circe.Json
import io.circe.syntax.*
import io.iohk.midnight.wallet.blockchain.data.*

object Transactions {

  val validCallTx: Transaction =
    Transaction(
      Transaction.Header(
        Hash[Transaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      ),
      ArbitraryJson(
        Json.obj(
          "type" := "Call",
          "address" := "Address",
          "functionName" := "Func",
          "proof" := "af5b8e94cb989ffabbf01df2fd8a36dcf4c7842b9312dc787153018a90e3eaeab3b00aae9ac",
          "nonce" := "42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c",
          "publicTranscript" := Json.arr(
            Json.obj(
              "functionName" := "identity",
              "arg" := Json.obj("arg1" := "argument"),
              "result" := Json.obj("final" := "success"),
            ),
          ),
        ),
      ),
    )

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
            "85dce76fc6a8".asJson,
            "5407a800dc02986ff9".asJson,
          ),
        ),
      ),
    )
}
