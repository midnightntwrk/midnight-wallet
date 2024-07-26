package io.iohk.midnight.wallet.engine

import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.js.JsWallet
import munit.CatsEffectSuite

class WalletBuilderSpec extends CatsEffectSuite with BetterOutputSuite {
  private val fakeIndexerUri = "http://localhost"
  private val fakeIndexerWSUri = "ws://localhost"
  private val fakeProverServerUri = "http://localhost"
  private val fakeSubstrateNodeUri = "http://localhost"

  private val initialState = JsWallet.generateInitialState()
  private val minLogLevel = "warn"

  test("Fail if indexer RPC uri is invalid") {
    val invalidIndexerUri = ""
    val config =
      Config.parse(
        RawConfig(
          invalidIndexerUri,
          fakeIndexerWSUri,
          fakeProverServerUri,
          fakeSubstrateNodeUri,
          Some(minLogLevel),
          None,
          discardTxHistory = Some(true),
        ),
      )

    config match {
      case Left(Config.ParseError.InvalidUri(_)) =>
      case _                                     => fail("Expected invalid uri error")
    }
  }

  test("Fail if indexer WS uri is invalid") {
    val invalidIndexerWSUri = ""
    val config =
      Config.parse(
        RawConfig(
          fakeIndexerUri,
          invalidIndexerWSUri,
          fakeProverServerUri,
          fakeSubstrateNodeUri,
          Some(minLogLevel),
          None,
          discardTxHistory = Some(true),
        ),
      )

    config match {
      case Left(Config.ParseError.InvalidUri(_)) =>
      case _                                     => fail("Expected invalid uri error")
    }
  }

  test("Fail if prover server uri is invalid") {
    val invalidProverServerUri = ""
    val config =
      Config.parse(
        RawConfig(
          fakeIndexerUri,
          fakeIndexerWSUri,
          invalidProverServerUri,
          fakeSubstrateNodeUri,
          Some(minLogLevel),
          None,
          discardTxHistory = Some(true),
        ),
      )

    config match {
      case Left(Config.ParseError.InvalidUri(_)) =>
      case _                                     => fail("Expected invalid uri error")
    }
  }

  test("Fail if substrate node uri is invalid") {
    val invalidSubstrateNodeUri = ""
    val config =
      Config.parse(
        RawConfig(
          fakeIndexerUri,
          fakeIndexerWSUri,
          fakeProverServerUri,
          invalidSubstrateNodeUri,
          Some(minLogLevel),
          None,
          discardTxHistory = Some(true),
        ),
      )

    config match {
      case Left(Config.ParseError.InvalidUri(_)) =>
      case _                                     => fail("Expected invalid uri error")
    }
  }

  test("Fail if initial state is invalid") {
    val invalidInitialState = "Invalid initial state"
    val config =
      Config.parse(
        RawConfig(
          fakeIndexerUri,
          fakeIndexerWSUri,
          fakeProverServerUri,
          fakeSubstrateNodeUri,
          Some(minLogLevel),
          Some(RawConfig.InitialState.SerializedSnapshot(invalidInitialState)),
          discardTxHistory = Some(true),
        ),
      )

    config match {
      case Left(Config.ParseError.InvalidSerializedSnapshot(_)) =>
      case _ => fail("Expected invalid initial state error")
    }
  }

  test("Fail if log level is invalid") {
    val invalidMinLogLevel = "bla_bla"
    val config =
      Config.parse(
        RawConfig(
          fakeIndexerUri,
          fakeIndexerWSUri,
          fakeProverServerUri,
          fakeSubstrateNodeUri,
          Some(invalidMinLogLevel),
          None,
          discardTxHistory = Some(true),
        ),
      )

    config match {
      case Left(Config.ParseError.InvalidLogLevel(_)) =>
      case _                                          => fail("Expected invalid log level error")
    }
  }

  test("Generate valid initial state") {
    val config =
      Config.parse(
        RawConfig(
          fakeIndexerUri,
          fakeIndexerWSUri,
          fakeProverServerUri,
          fakeSubstrateNodeUri,
          Some(minLogLevel),
          Some(RawConfig.InitialState.SerializedSnapshot(initialState)),
          discardTxHistory = Some(true),
        ),
      )
    assert(config.isRight)
  }
}
