package io.iohk.midnight.wallet.engine.tracing

import io.iohk.midnight.wallet.engine.WalletBuilder

sealed trait WalletBuilderEvent

object WalletBuilderEvent {

  /** The `WalletBuilder` received a request to construct a new wallet based on the given config.
    */
  final case class BuildRequested(config: WalletBuilder.Config) extends WalletBuilderEvent

  /** The `Wallet` was built successfully.
    */
  case object WalledBuildSuccess extends WalletBuilderEvent

  /** Building the `Wallet` failed for the given reason.
    */
  final case class WalletBuildError(reason: String) extends WalletBuilderEvent

}
