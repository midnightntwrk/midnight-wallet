package io.iohk.midnight.wallet.api

import scala.scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.JSGlobal
import typings.api.*

@js.native
@JSGlobal
class NativeWalletImpl extends Wallet

class WalletImpl extends NativeWalletImpl {
  override def call(
      contractHash: Hash,
      transitionFunction: TransitionFunction,
      publicTranscript: PublicTranscript,
  ): Promise[CallResult] = ???

  override def deploy(
      contractSource: ContractSource,
  ): Promise[CallResult] = ???
}
