package io.iohk.midnight.wallet.api

import scala.scalajs.js.Promise
import typings.api.*

class WalletImpl extends Wallet:
  override def call(
      deployTransactionHash: Hash,
      transitionFunction: TransitionFunction,
      publicTranscript: PublicTranscript,
  ): Promise[CallResult] = ???

  override def deploy(
      contractSource: ContractSource,
  ): Promise[CallResult] = ???
