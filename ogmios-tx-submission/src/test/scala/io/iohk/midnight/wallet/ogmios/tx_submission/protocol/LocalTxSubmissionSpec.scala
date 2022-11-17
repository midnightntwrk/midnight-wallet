package io.iohk.midnight.wallet.ogmios.tx_submission.protocol

import io.iohk.midnight.wallet.ogmios.tx_submission.examples
import io.iohk.midnight.wallet.ogmios.tx_submission.examples.{
  AcceptTx,
  LocalTxSubmissionDone,
  RejectTx,
}
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.Decoders.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.Encoders.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.{Receive, Send}
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Receive.RejectTxDetails
import io.iohk.midnight.wallet.ogmios.util.WithJsonWebSocketClient

class LocalTxSubmissionSpec extends WithJsonWebSocketClient {
  test("send SubmitTx") {
    assertSend[Send](
      examples.SubmitTx.validCallObject,
      examples.SubmitTx.validJsonCall,
    )
  }

  test("send LocalTxSubmission Done") {
    assertSend[Send](
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
