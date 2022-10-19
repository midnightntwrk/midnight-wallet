package io.iohk.midnight.wallet.ogmios.sync.examples

import io.circe.Json
import io.circe.syntax.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.*

object SubmitTx {

  val validCallTx: Transaction =
    data.Transaction(
      data.Transaction.Header(
        Hash[Transaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      ),
      ArbitraryJson(
        Json.obj(
          "address" := "Address",
          "functionName" := "Func",
          "proof" := "Proof",
          "nonce" := "nonce",
          "transcript" := Json.arr(
            Json.obj("functionName" := "identity", "arg" := Json.obj(), "result" := Json.obj()),
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
          "transitionFunctionCircuits" := Json
            .arr("6232e241fc01f4".asJson, "e050935684748401".asJson),
        ),
      ),
    )
}
