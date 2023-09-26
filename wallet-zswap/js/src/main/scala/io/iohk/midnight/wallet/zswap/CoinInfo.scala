package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightZswap.mod
import scala.scalajs.js

opaque type CoinInfo = mod.CoinInfo

object CoinInfo {
  def apply(tokenType: TokenType, value: BigInt): CoinInfo =
    mod.createCoinInfo(tokenType, value.toJsBigInt)

  def fromJs(coin: mod.CoinInfo): CoinInfo = coin

  extension (coin: CoinInfo) {
    def toJs: mod.CoinInfo = coin

    def tokenType: TokenType = coin.`type`
    def value: BigInt = coin.value.toScalaBigInt
  }
}
