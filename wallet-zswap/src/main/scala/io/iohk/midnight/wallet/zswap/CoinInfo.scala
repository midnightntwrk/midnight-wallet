package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import scala.scalajs.js

trait CoinInfo[T, TokenType] {
  def create(tokenType: TokenType, value: BigInt): T
  def fromJs(jsCoin: v1.CoinInfo): T

  extension (t: T) {
    def tokenType: TokenType
    def value: BigInt
  }
}

given CoinInfo[v1.CoinInfo, v1.TokenType] with {
  override def create(tokenType: v1.TokenType, value: BigInt): v1.CoinInfo =
    v1.createCoinInfo(tokenType, value.toJsBigInt)

  override def fromJs(jsCoin: v1.CoinInfo): v1.CoinInfo =
    create(jsCoin.`type`, jsCoin.value.toScalaBigInt)

  extension (t: v1.CoinInfo) {
    override def tokenType: v1.TokenType = t.`type`
    override def value: BigInt = t.value.toScalaBigInt
  }
}
