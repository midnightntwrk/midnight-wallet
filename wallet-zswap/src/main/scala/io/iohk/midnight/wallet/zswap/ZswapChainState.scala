package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

opaque type ZswapChainState = mod.ZswapChainState

object ZswapChainState {
  def apply(): ZswapChainState = new mod.ZswapChainState()

  extension (state: ZswapChainState) {
    private[zswap] def toJs: mod.ZswapChainState = state

    def tryApply(offer: Offer): ZswapChainState =
      state.tryApply(offer.toJs)._1
  }
}
