package io.iohk.midnight.wallet.ouroboros.tx_submission.examples

object AcceptTx {

  val validJson: String =
    """{
      |  "protocol": "LocalTxSubmission",
      |  "type": "AcceptTx"
      |}""".stripMargin
}
