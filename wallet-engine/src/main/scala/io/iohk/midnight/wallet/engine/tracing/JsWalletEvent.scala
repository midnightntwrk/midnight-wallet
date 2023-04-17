package io.iohk.midnight.wallet.engine.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}

sealed trait JsWalletEvent

object JsWalletEvent {

  /** The construction of a new wallet was requested for the given parameters.
    */
  final case class JsWalletBuildRequested(rawConfig: RawConfig) extends JsWalletEvent

  object JsWalletBuildRequested {
    val id: Event.Id[JsWalletBuildRequested] = Event.Id("js_wallet_build_requested")
  }

  /** The final config that will be used for the wallet construction has been created.
    */
  final case class ConfigConstructed(config: Config) extends JsWalletEvent

  object ConfigConstructed {
    val id: Event.Id[ConfigConstructed] = Event.Id("config_constructed")
  }

  /** One or multiple config parameters where invalid.
    */
  final case class InvalidConfig(details: String) extends JsWalletEvent

  object InvalidConfig {
    val id: Event.Id[InvalidConfig] = Event.Id("invalid_config")
  }

  object DefaultInstances {

    implicit val jsWalletBuildRequestedContext: AsStringLogContext[JsWalletBuildRequested] =
      AsStringLogContext.fromMap[JsWalletBuildRequested](evt =>
        Map(
          "initialState" -> evt.rawConfig.initialState.show,
          "minLogLevel" -> evt.rawConfig.minLogLevel.show,
        ),
      )

    implicit val configConstructedContext: AsStringLogContext[ConfigConstructed] =
      AsStringLogContext.fromMap[ConfigConstructed](evt =>
        Map(
          "config" -> evt.config.show,
        ),
      )

    implicit val invalidConfigContext: AsStringLogContext[InvalidConfig] =
      AsStringLogContext.fromMap[InvalidConfig](evt =>
        Map(
          "details" -> evt.details,
        ),
      )

  }

}
