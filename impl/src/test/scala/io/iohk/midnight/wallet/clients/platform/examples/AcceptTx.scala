package io.iohk.midnight.wallet.clients.platform.examples

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync

object AcceptTx:

  val validJson =
    """{
    |  "protocol": "LocalTxSubmission",
    |  "type": "AcceptTx"
    |}""".stripMargin
