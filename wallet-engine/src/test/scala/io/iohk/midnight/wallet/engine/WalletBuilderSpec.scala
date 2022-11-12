package io.iohk.midnight.wallet.engine

import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite

class WalletBuilderSpec extends CatsEffectSuite with BetterOutputSuite {
  test("Fail if node URI is invalid") {
    val uri = "%"
    val initialState = WalletBuilder.generateInitialState()
    val config = Config.parse(uri, Some(initialState))
    config match {
      case Right(_) | Left(Config.Error.InvalidUri(_)) =>
      case Left(t)                                     => fail("Expected invalid URI error", t)
    }
  }

  test("Fail if initial state is invalid") {
    val uri = "ws://localhost:5205"
    val initialState = "Invalid initial state"
    val config = WalletBuilder.Config.parse(uri, Some(initialState))
    config match {
      case Right(_) | Left(LedgerSerialization.Error.InvalidInitialState(_)) =>
      case Left(t) => fail("Expected invalid initial sate error", t)
    }
  }

  test("Generate valid initial state") {
    val uri = "ws://localhost:5205"
    val initialState = WalletBuilder.generateInitialState()
    val config = WalletBuilder.Config.parse(uri, Some(initialState))
    assert(config.isRight)
  }
}
