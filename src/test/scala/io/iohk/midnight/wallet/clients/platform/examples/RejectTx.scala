package io.iohk.midnight.wallet.clients.platform.examples

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission.RejectTxDetails

object RejectTx {

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
      |    "reason": "􅟢7£R"
      |  }
      |}""".stripMargin

  val validObjectOther =
    LocalTxSubmission.RejectTx(RejectTxDetails.Other("􅟢7£R"))
}
