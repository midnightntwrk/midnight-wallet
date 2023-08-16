package io.iohk.midnight.wallet.engine

import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.js.{JsWallet, NodeConnection, SubmitSession, SyncSession}
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite

import scala.scalajs.js.Promise

class WalletBuilderSpec extends CatsEffectSuite with BetterOutputSuite {
  @SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
  private val mockedNodeConnection = new NodeConnection {
    override def startSyncSession(): Promise[SyncSession] = ???
    override def startSubmitSession(): Promise[SubmitSession] = ???
  }

  test("Fail if initial state is invalid") {
    val initialState = "Invalid initial state"
    val minLogLevel = "Warn"
    val config =
      Config.parse(RawConfig(mockedNodeConnection, Some(initialState), Some(minLogLevel)))

    config match {
      case Left(LedgerSerialization.Error.InvalidInitialState(_)) =>
      case _ => fail("Expected invalid initial sate error")
    }
  }

  test("Fail if log level is invalid") {
    val initialState = JsWallet.generateInitialState()
    val minLogLevel = "bla_bla"
    val config =
      Config.parse(RawConfig(mockedNodeConnection, Some(initialState), Some(minLogLevel)))

    config match {
      case Left(Config.ParseError.InvalidLogLevel(_)) =>
      case _                                          => fail("Expected invalid log level error")
    }
  }

  test("Generate valid initial state") {
    val initialState = JsWallet.generateInitialState()
    val minLogLevel = "Warn"
    val config =
      Config.parse(RawConfig(mockedNodeConnection, Some(initialState), Some(minLogLevel)))
    assert(config.isRight)
  }
}
