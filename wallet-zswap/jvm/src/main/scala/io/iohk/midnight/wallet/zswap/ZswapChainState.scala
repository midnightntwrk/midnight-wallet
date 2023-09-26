package io.iohk.midnight.wallet.zswap

opaque type ZswapChainState = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object ZswapChainState {
  def apply(): ZswapChainState = ???

  extension (state: ZswapChainState) {
    def firstFree: BigInt = ???
    def tryApplyProofErased(offer: ProofErasedOffer): ZswapChainState = ???
    def tryApply(offer: Offer): ZswapChainState = ???
  }
}
