package io.iohk.midnight.wallet.clients.platform.examples

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync
import io.iohk.midnight.wallet.domain.{Block, Hash}

object RollBackward:

  val validJson =
    """{
    |  "protocol": "LocalBlockSync",
    |  "type": "RollBackward",
    |  "payload": "0ed5b409978a014aa7af13f5d2f14e571268ca8c7e7c0972545000c66ff5118a"
    |}""".stripMargin

  val validObject = LocalBlockSync.RollBackward(
    Hash[Block]("0ed5b409978a014aa7af13f5d2f14e571268ca8c7e7c0972545000c66ff5118a"),
  )
