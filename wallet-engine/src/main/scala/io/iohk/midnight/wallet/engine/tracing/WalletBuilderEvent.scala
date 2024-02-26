package io.iohk.midnight.wallet.engine.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.engine.config.Config

sealed trait WalletBuilderEvent

object WalletBuilderEvent {

  /** The `WalletBuilder` received a request to construct a new wallet based on the given config.
    */
  final case class BuildRequested(config: Config) extends WalletBuilderEvent

  object BuildRequested {
    val id: Event.Id[BuildRequested] = Event.Id("build_requested")
  }

  /** The `Wallet` was built successfully.
    */
  case object WalletBuildSuccess extends WalletBuilderEvent {
    val id: Event.Id[WalletBuildSuccess.type] = Event.Id("wallet_build_success")
  }

  /** Building the `Wallet` failed for the given reason.
    */
  final case class WalletBuildError(reason: String) extends WalletBuilderEvent

  object WalletBuildError {
    val id: Event.Id[WalletBuildError] = Event.Id("wallet_build_error")
  }

  object DefaultInstances {

    implicit val buildRequestedContext: AsStringLogContext[BuildRequested] =
      AsStringLogContext.fromEvent(evt => "config" -> evt.config.show)
    implicit val walletBuildErrorContext: AsStringLogContext[WalletBuildError] =
      AsStringLogContext.fromEvent(evt => "reason" -> evt.reason)

  }

}
