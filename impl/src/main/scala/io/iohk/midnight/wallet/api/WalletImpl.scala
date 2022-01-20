package io.iohk.midnight.wallet.api

import scala.scalajs.js.Promise
import typings.api.*

class WalletImpl extends Wallet:
  override def call(
      deployTransactionHash: Hash,
      transitionFunction: TransitionFunction,
      publicTranscript: PublicTranscript,
      privateStateUpdate: StateUpdate,
  ): Promise[CallResult] = ???

  override def deploy(
      contractSource: ContractSource,
      initialState: ContractPrivateState,
  ): Promise[CallResult] = ???
