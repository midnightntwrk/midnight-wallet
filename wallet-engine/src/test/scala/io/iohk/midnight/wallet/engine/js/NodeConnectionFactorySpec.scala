package io.iohk.midnight.wallet.engine.js

import io.iohk.midnight.wallet.engine.js.NodeConnectionFactory.InvalidUri
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite

class NodeConnectionFactorySpec extends BetterOutputSuite {

  test("NodeConnectionFactory.create should return InvalidUri when given URI is invalid") {
    assertEquals(
      NodeConnectionFactory.create("ws://localhost:1234:1234"),
      Left(InvalidUri("port specified multiple times")),
    )
  }

  test("NodeConnectionFactory.create should return NodeConnection when given URI is valid") {
    assert(NodeConnectionFactory.create("ws://localhost:1234").isRight)
  }
}
