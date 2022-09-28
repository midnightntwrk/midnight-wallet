package io.iohk.midnight.wallet.ogmios.sync.examples

import io.circe.Json
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.*

import java.time.Instant

object SubmitTx {

  val validCallTx: CallTransaction =
    data.CallTransaction(
      Hash[CallTransaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      Instant.parse("1969-12-31T23:59:59.999391Z"),
      Address("Address"),
      FunctionName("Func"),
      Proof("Proof"),
      Nonce("Nonce"),
      Transcript(
        Seq(Query(FunctionName("identity"), ArbitraryJson(Json.obj()), ArbitraryJson(Json.obj()))),
      ),
    )

  val validDeployTx: DeployTransaction =
    DeployTransaction(
      Hash[DeployTransaction](
        "8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe",
      ),
      Instant.parse("1969-12-31T23:59:57.999536Z"),
      Contract(
        Some(
          PublicOracle(
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
        Some(
          PrivateOracle(
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
      TransitionFunctionCircuits(Seq("6232e241fc01f4", "e050935684748401")),
    )
}
