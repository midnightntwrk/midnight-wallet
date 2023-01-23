package io.iohk.midnight.wallet.ouroboros.tx_submission.examples

import io.iohk.midnight.wallet.ouroboros.tx_submission.TestDomain.Transaction
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Hash

object SubmitTx {

  val validJsonCall: String =
    """{
      |  "protocol" : "LocalTxSubmission",
      |  "type" : "SubmitTx",
      |  "payload" : {
      |    "hash" : "3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"
      |  }
      |}""".stripMargin

  val validCallTx: Transaction =
    Transaction(Hash("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"))

  val validCallObject: LocalTxSubmission.Send.SubmitTx[Transaction] =
    LocalTxSubmission.Send.SubmitTx(validCallTx)
}
