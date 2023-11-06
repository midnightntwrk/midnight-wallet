package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.js.interop.util.BigIntOps.*

opaque type ZswapChainState = mod.ZswapChainState

object ZswapChainState {
  def apply(): ZswapChainState = new mod.ZswapChainState()

  extension (state: ZswapChainState) {
    private[zswap] def toJs: mod.ZswapChainState = state

    def firstFree: BigInt = state.firstFree.toScalaBigInt

    def tryApplyProofErased(offer: ProofErasedOffer): ZswapChainState =
      state.tryApplyProofErased(offer.toJs)._1

    def tryApply(offer: Offer): ZswapChainState =
      state.tryApply(offer.toJs)._1
  }
}
