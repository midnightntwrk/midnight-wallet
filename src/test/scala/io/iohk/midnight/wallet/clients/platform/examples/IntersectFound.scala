package io.iohk.midnight.wallet.clients.platform.examples

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync
import io.iohk.midnight.wallet.domain.{Block, Hash}

object IntersectFound {

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "IntersectFound",
      |  "payload": "6dc0451c59ff10915da70119a9cfbc03068ba2e7d99b1fff1693c154e5f82126"
      |}""".stripMargin

  val validObject: LocalBlockSync.IntersectFound =
    LocalBlockSync.IntersectFound(
      Hash[Block]("6dc0451c59ff10915da70119a9cfbc03068ba2e7d99b1fff1693c154e5f82126"),
    )
}
