package io.iohk.midnight.wallet.clients.platform

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission.*
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage

class PlatformClientTxSubmissionSpec extends PlatformClientSpec {
  test("send SubmitTx call") {
    assertSend(
      examples.SubmitTx.validObjectCall,
      examples.SubmitTx.validJsonCall,
    )
  }

  test("send SubmitTx deploy") {
    assertSend(
      examples.SubmitTx.validObjectDeploy,
      examples.SubmitTx.validJsonDeploy,
    )
  }

  test("send LocalTxSubmission Done") {
    assertSend(
      SendMessage.LocalTxSubmission.Done,
      examples.LocalTxSubmissionDone.validJson,
    )
  }

  test("receive AcceptTx") {
    assertReceive(
      examples.AcceptTx.validJson,
      AcceptTx,
    )
  }

  test("receive RejectTx Duplicate") {
    assertReceive(
      examples.RejectTx.validJsonDuplicate,
      RejectTx(RejectTxDetails.Duplicate),
    )
  }

  test("receive RejectTx Other") {
    assertReceive(
      examples.RejectTx.validJsonOther,
      examples.RejectTx.validObjectOther,
    )
  }
}
