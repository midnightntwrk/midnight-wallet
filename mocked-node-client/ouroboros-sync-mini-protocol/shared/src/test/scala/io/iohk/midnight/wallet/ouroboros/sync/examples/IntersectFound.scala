package io.iohk.midnight.wallet.ouroboros.sync.examples

import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash

object IntersectFound {

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "IntersectFound",
      |  "payload": "6dc0451c59ff10915da70119a9cfbc03068ba2e7d99b1fff1693c154e5f82126"
      |}""".stripMargin

  val validObject: LocalBlockSync.Receive.IntersectFound =
    LocalBlockSync.Receive.IntersectFound(
      Hash("6dc0451c59ff10915da70119a9cfbc03068ba2e7d99b1fff1693c154e5f82126"),
    )
}
