package io.iohk.midnight.wallet.ogmios.sync.examples

import io.iohk.midnight.wallet.blockchain.data.{Block, Hash}
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync

object IntersectFound {

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "IntersectFound",
      |  "payload": "6dc0451c59ff10915da70119a9cfbc03068ba2e7d99b1fff1693c154e5f82126"
      |}""".stripMargin

  val validObject: LocalBlockSync.Receive.IntersectFound =
    LocalBlockSync.Receive.IntersectFound(
      Hash[Block]("6dc0451c59ff10915da70119a9cfbc03068ba2e7d99b1fff1693c154e5f82126"),
    )
}
