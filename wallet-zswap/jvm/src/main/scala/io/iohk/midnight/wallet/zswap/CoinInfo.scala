package io.iohk.midnight.wallet.zswap

opaque type CoinInfo = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object CoinInfo {
  def apply(tokenType: TokenType, value: BigInt): CoinInfo = ???

  extension (coin: CoinInfo) {
    def tokenType: TokenType = ???
    def value: BigInt = ???
  }
}
