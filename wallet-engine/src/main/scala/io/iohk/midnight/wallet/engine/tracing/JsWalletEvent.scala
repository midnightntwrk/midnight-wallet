package io.iohk.midnight.wallet.engine.tracing

import io.iohk.midnight.wallet.engine.WalletBuilder

sealed trait JsWalletEvent

object JsWalletEvent {

  /** The construction of a new wallet was requested for the given parameters.
    */
  final case class WalletBuildRequested(
      platformUri: String,
  ) extends JsWalletEvent

  /** The final config that will be used for the wallet construction has been created.
    */
  final case class ConfigConstructed(config: WalletBuilder.Config) extends JsWalletEvent

  /** One or multiple config parameters where invalid.
    */
  final case class InvalidConfig(details: String) extends JsWalletEvent

}
