package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

opaque type ProofErasedOffer = mod.ProofErasedOffer

object ProofErasedOffer {
  def fromJs(offer: mod.ProofErasedOffer): ProofErasedOffer = offer

  extension (offer: ProofErasedOffer) {
    def toJs: mod.ProofErasedOffer = offer
  }
}
