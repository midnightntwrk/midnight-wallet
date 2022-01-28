package io.iohk.midnight.wallet.clients.platform

import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage

class PlatformClientBlockSyncSpec extends PlatformClientSpec {
  test("receive AwaitReply") {
    assertReceive(
      examples.AwaitReply.validJson,
      LocalBlockSync.AwaitReply,
    )
  }

  test("receive IntersectFound") {
    assertReceive(
      examples.IntersectFound.validJson,
      examples.IntersectFound.validObject,
    )
  }

  test("receive IntersectNotFound") {
    assertReceive(
      examples.IntersectNotFound.validJson,
      LocalBlockSync.IntersectNotFound,
    )
  }

  test("receive RollBackward") {
    assertReceive(
      examples.RollBackward.validJson,
      examples.RollBackward.validObject,
    )
  }

  test("receive RollForward") {
    assertReceive(
      examples.RollForward.validJson,
      examples.RollForward.validObject,
    )
  }

  // TODO (LLW-110): This test should pass
  test("receive RollForward with very big height".ignore) {
    assertReceive(
      examples.RollForward.veryBigHeightJson,
      examples.RollForward.veryBigHeightObject,
    )
  }

  test("send RequestNext") {
    assertSend(
      SendMessage.LocalBlockSync.RequestNext,
      examples.RequestNext.validJson,
    )
  }

  test("send FindIntersect") {
    assertSend(
      examples.FindIntersect.validObject,
      examples.FindIntersect.validJson,
    )
  }

  test("send LocalBlockSync Done") {
    assertSend(
      SendMessage.LocalBlockSync.Done,
      examples.LocalBlockSyncDone.validJson,
    )
  }
}
