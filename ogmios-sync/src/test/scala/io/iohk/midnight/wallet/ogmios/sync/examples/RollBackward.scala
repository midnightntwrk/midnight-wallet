package io.iohk.midnight.wallet.ogmios.sync.examples

import io.iohk.midnight.wallet.domain.{Block, Hash}
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync

object RollBackward {

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "RollBackward",
      |  "payload": "0ed5b409978a014aa7af13f5d2f14e571268ca8c7e7c0972545000c66ff5118a"
      |}""".stripMargin

  val validObject: LocalBlockSync.Receive.RollBackward = LocalBlockSync.Receive.RollBackward(
    Hash[Block]("0ed5b409978a014aa7af13f5d2f14e571268ca8c7e7c0972545000c66ff5118a"),
  )
}
