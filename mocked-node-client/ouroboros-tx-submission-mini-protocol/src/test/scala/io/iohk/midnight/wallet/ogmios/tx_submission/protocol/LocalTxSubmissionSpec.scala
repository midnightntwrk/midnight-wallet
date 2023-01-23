package io.iohk.midnight.wallet.ouroboros.tx_submission.protocol

import io.iohk.midnight.wallet.ouroboros.tx_submission.TestDomain.Transaction
import io.iohk.midnight.wallet.ouroboros.tx_submission.examples
import io.iohk.midnight.wallet.ouroboros.tx_submission.examples.{
  AcceptTx,
  LocalTxSubmissionDone,
  RejectTx,
}
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.Decoders.*
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.Encoders.*
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Receive.RejectTxDetails
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.{Receive, Send}
import io.iohk.midnight.wallet.ouroboros.util.WithJsonWebSocketClient

class LocalTxSubmissionSpec extends WithJsonWebSocketClient {
  import io.iohk.midnight.wallet.ouroboros.tx_submission.TestDomain.Transaction.encoder

  test("send SubmitTx") {
    assertSend[Send[Transaction]](
      examples.SubmitTx.validCallObject,
      examples.SubmitTx.validJsonCall,
    )
  }

  test("send LocalTxSubmission Done") {
    assertSend[Send[Transaction]](
      Send.Done,
      LocalTxSubmissionDone.validJson,
    )
  }

  test("receive AcceptTx") {
    assertReceive[Receive](
      AcceptTx.validJson,
      Receive.AcceptTx,
    )
  }

  test("receive RejectTx Duplicate") {
    assertReceive[Receive](
      RejectTx.validJsonDuplicate,
      Receive.RejectTx(RejectTxDetails.Duplicate),
    )
  }

  test("receive RejectTx Other") {
    assertReceive[Receive](
      examples.RejectTx.validJsonOther,
      examples.RejectTx.validObjectOther,
    )
  }
}
