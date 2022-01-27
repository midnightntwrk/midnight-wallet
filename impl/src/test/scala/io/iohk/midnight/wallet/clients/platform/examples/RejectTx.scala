package io.iohk.midnight.wallet.clients.platform.examples

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission.RejectTxDetails
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.{
  LocalBlockSync,
  LocalTxSubmission,
}

object RejectTx:

  val validJsonDuplicate =
    """{
    |  "protocol": "LocalTxSubmission",
    |  "type": "RejectTx",
    |  "payload": {
    |    "type": "Duplicate"
    |  }
    |}""".stripMargin

  val validJsonOther =
    """{
    |  "protocol": "LocalTxSubmission",
    |  "type": "RejectTx",
    |  "payload": {
    |    "type": "Other",
    |    "reason": "􅟢7\u001bࢫ£R"
    |  }
    |}""".stripMargin

  val validObjectOther =
    LocalTxSubmission.RejectTx(RejectTxDetails.Other("􅟢7\u001bࢫ£R"))
