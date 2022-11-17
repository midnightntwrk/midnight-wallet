package io.iohk.midnight.wallet.ogmios.sync.examples

import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync
import java.time.Instant

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
      |          "header": {
      |            "hash": "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7"
      |          },
      |          "body": "AAAAAAAAAAABAAAAAAAAAK"
      |        }
      |      ]
      |    }
      |  }
      |}""".stripMargin

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
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
            Transaction(
              Transaction.Header(
                Hash[Transaction](
                  "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
                ),
              ),
              "AAAAAAAAAAABAAAAAAAAAK",
            ),
          ),
        ),
      ),
    )
}
