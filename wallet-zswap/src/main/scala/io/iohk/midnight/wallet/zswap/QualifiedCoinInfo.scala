package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1

trait QualifiedCoinInfo[T, TokenType, Nonce] {
  extension (t: T) {
    def tokenType: TokenType
    def value: BigInt
    def nonce: Nonce
  }
}

given QualifiedCoinInfo[v1.QualifiedCoinInfo, v1.TokenType, v1.Nonce] with {
  extension (coin: v1.QualifiedCoinInfo) {
    override def tokenType: v1.TokenType = coin.`type`
    override def value: BigInt = coin.value.toScalaBigInt
    override def nonce: v1.Nonce = coin.nonce
  }
}
