package io.iohk.midnight.wallet.engine.tracing

import cats.syntax.show.*
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.tracer.logging.AsStringLogContext
import io.iohk.midnight.tracer.logging.Event

sealed trait JsWalletEvent

object JsWalletEvent {

  /** The construction of a new wallet was requested for the given parameters.
    */
  final case class JsWalletBuildRequested(
      nodeUri: String,
      initialState: Option[String],
      minLogLevel: Option[String],
  ) extends JsWalletEvent

  object JsWalletBuildRequested {
    val id: Event.Id[JsWalletBuildRequested] = Event.Id("js_wallet_build_requested")
  }

  /** The final config that will be used for the wallet construction has been created.
    */
  final case class ConfigConstructed(config: WalletBuilder.Config) extends JsWalletEvent

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

    implicit val jsWalletBuildRequstedContext: AsStringLogContext[JsWalletBuildRequested] =
      AsStringLogContext.fromMap[JsWalletBuildRequested](evt =>
        Map(
          "nodeUri" -> evt.nodeUri,
          "initialState" -> evt.initialState.show,
          "minLogLevel" -> evt.minLogLevel.show,
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
