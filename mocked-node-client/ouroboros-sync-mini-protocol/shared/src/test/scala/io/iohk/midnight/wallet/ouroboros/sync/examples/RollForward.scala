package io.iohk.midnight.wallet.ouroboros.sync.examples

import io.iohk.midnight.wallet.ouroboros.sync.TestDomain.{Block, Transaction}
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash

object RollForward {

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "RollForward",
      |  "payload": {
      |     "hash": "5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38",
      |     "height" : 0,
      |     "transactions": [{"hash":"bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7"}]
      |  }
      |}""".stripMargin

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  val validObject: LocalBlockSync.Receive.RollForward[Block] =
    LocalBlockSync.Receive.RollForward(
      Block(
        height = 0,
        hash = Hash("5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38"),
        transactions = Seq(
          Transaction(
            Hash("bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7"),
          ),
        ),
      ),
    )
}
