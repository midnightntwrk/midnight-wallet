package io.iohk.midnight.wallet.core.tracing

import io.iohk.midnight.wallet.core.Wallet

sealed trait WalletEvent

object WalletEvent {

  /** The `Wallet` has received a request to call the given contract.
    */
  final case class CallContractRequest(input: Wallet.CallContractInput) extends WalletEvent

  /** The `Wallet` has received a request to deploy the given contract.
    */
  final case class DeployContractRequest(input: Wallet.DeployContractInput) extends WalletEvent

  /** The `Wallet` has received a request to start syncing.
    */
  case object SyncRequest extends WalletEvent

}
