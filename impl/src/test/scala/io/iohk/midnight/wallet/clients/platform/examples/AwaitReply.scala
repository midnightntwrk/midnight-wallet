package io.iohk.midnight.wallet.clients.platform.examples

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync

object AwaitReply:

  val validJson =
    """{
    |  "protocol": "LocalBlockSync",
    |  "type": "AwaitReply"
    |}""".stripMargin
