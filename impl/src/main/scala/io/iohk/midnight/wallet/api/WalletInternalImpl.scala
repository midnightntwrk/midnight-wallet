package io.iohk.midnight.wallet.api

import scala.scalajs.js
import scala.scalajs.js.annotation.JSGlobal
import typings.api.mod.*

@js.native
@JSGlobal
class NativeWalletImpl extends WalletInternal

class WalletInternalImpl extends NativeWalletImpl {
  override def call(
      contractHash: Hash,
      transitionFunction: TransitionFunction,
      publicTranscript: PublicTranscript,
  ): js.Promise[CallResult] = ???

  override def deploy(
      contractSource: ContractSource,
      publicState: PublicState,
  ): js.Promise[CallResult] = ???

  override def sync(f: js.Function1[js.Array[SemanticEvent], Unit]): Unit = ???

  override def getGUID(): js.Promise[GUID] = ???
}
