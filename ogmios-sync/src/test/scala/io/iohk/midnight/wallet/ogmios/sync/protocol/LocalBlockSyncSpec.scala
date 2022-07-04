package io.iohk.midnight.wallet.ogmios.sync.protocol

import io.circe.CursorOp.DownField
import io.circe.DecodingFailure
import io.iohk.midnight.wallet.ogmios.sync.examples
import io.iohk.midnight.wallet.ogmios.sync.examples.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.Decoders.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.Encoders.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync.{Receive, Send}
import io.iohk.midnight.wallet.ogmios.sync.util.WithJsonWebSocketClient

class LocalBlockSyncSpec extends WithJsonWebSocketClient {
  test("receive AwaitReply") {
    assertReceive[Receive](
      AwaitReply.validJson,
      Receive.AwaitReply,
    )
  }

  test("receive IntersectFound") {
    assertReceive[Receive](
      IntersectFound.validJson,
      examples.IntersectFound.validObject,
    )
  }

  test("receive IntersectNotFound") {
    assertReceive[Receive](
      IntersectNotFound.validJson,
      Receive.IntersectNotFound,
    )
  }

  test("receive RollBackward") {
    assertReceive[Receive](
      RollBackward.validJson,
      examples.RollBackward.validObject,
    )
  }

  test("receive RollForward") {
    assertReceive[Receive](
      RollForward.validJson,
      examples.RollForward.validObject,
    )
  }

  test("fail in case of incorrect type") {
    val message =
      """{
        |  "protocol": "LocalBlockSync",
        |  "type": "This Is Wrong"
        |}""".stripMargin

    val expected =
      DecodingFailure(
        "Invalid value \"This Is Wrong\" for discriminator \"type\"",
        List(DownField("type")),
      )

    buildClientWithInitialReceive(List(message))
      .map(_.receive[Receive]())
      .map(_.attempt)
      .use(assertIO(_, Left(expected)))
  }

  test("send RequestNext") {
    assertSend[Send](
      Send.RequestNext,
      RequestNext.validJson,
    )
  }

  test("send FindIntersect") {
    assertSend[Send](
      FindIntersect.validObject,
      examples.FindIntersect.validJson,
    )
  }

  test("send LocalBlockSync Done") {
    assertSend[Send](
      Send.Done,
      LocalBlockSyncDone.validJson,
    )
  }
}
