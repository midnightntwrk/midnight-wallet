package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

trait ZswapChainState[T, Offer] {
  def create(): T

  extension (t: T) {
    def tryApply(offer: Offer): T
  }
}

given ZswapChainState[mod.ZswapChainState, mod.Offer] with {
  def create(): mod.ZswapChainState = new mod.ZswapChainState()

  extension (state: mod.ZswapChainState) {
    def tryApply(offer: mod.Offer): mod.ZswapChainState =
      state.tryApply(offer)._1
  }
}
