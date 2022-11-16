package io.iohk.midnight.wallet.engine

import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite

class WalletBuilderSpec extends CatsEffectSuite with BetterOutputSuite {
  test("Fail if node URI is invalid") {
    val uri = "%"
    val initialState = WalletBuilder.generateInitialState()
    val minLogLevel = "Warn"
    val config = Config.parse(uri, Some(initialState), Some(minLogLevel))

    config match {
      case Left(Config.Error.InvalidUri(_)) =>
      case _                                => fail("Expected invalid URI error")
    }
  }

  test("Fail if initial state is invalid") {
    val uri = "ws://localhost:5205"
    val initialState = "Invalid initial state"
    val minLogLevel = "Warn"
    val config = WalletBuilder.Config.parse(uri, Some(initialState), Some(minLogLevel))

    config match {
      case Left(LedgerSerialization.Error.InvalidInitialState(_)) =>
      case _ => fail("Expected invalid initial sate error")
    }
  }

  test("Fail if log level is invalid") {
    val uri = "ws://localhost:5205"
    val initialState = WalletBuilder.generateInitialState()
    val minLogLevel = "bla_bla"
    val config = WalletBuilder.Config.parse(uri, Some(initialState), Some(minLogLevel))

    config match {
      case Left(Config.Error.InvalidLogLevel(_)) =>
      case _                                     => fail("Expected invalid log level error")
    }
  }

  test("Generate valid initial state") {
    val uri = "ws://localhost:5205"
    val initialState = WalletBuilder.generateInitialState()
    val minLogLevel = "Warn"
    val config = WalletBuilder.Config.parse(uri, Some(initialState), Some(minLogLevel))
    assert(config.isRight)
  }
}
