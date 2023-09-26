package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightZswap.mod

opaque type QualifiedCoinInfo = mod.QualifiedCoinInfo

object QualifiedCoinInfo {
  private[zswap] def fromJs(jsCoin: mod.QualifiedCoinInfo): QualifiedCoinInfo = jsCoin

  extension (coin: QualifiedCoinInfo) {
    def toJs: mod.QualifiedCoinInfo = coin

    def tokenType: TokenType = coin.`type`
    def value: BigInt = coin.value.toScalaBigInt
    def nonce: Nonce = coin.nonce
  }
}
