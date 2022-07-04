package io.iohk.midnight.wallet.ogmios.tx_submission.examples

import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Receive

object RejectTx {

  val validJsonDuplicate: String =
    """{
      |  "protocol": "LocalTxSubmission",
      |  "type": "RejectTx",
      |  "payload": {
      |    "type": "Duplicate"
      |  }
      |}""".stripMargin

  val validJsonOther: String =
    """{
      |  "protocol": "LocalTxSubmission",
      |  "type": "RejectTx",
      |  "payload": {
      |    "type": "Other",
      |    "reason": "􅟢7£R"
      |  }
      |}""".stripMargin

  val validObjectOther: Receive.RejectTx =
    Receive.RejectTx(Receive.RejectTxDetails.Other("􅟢7£R"))
}
