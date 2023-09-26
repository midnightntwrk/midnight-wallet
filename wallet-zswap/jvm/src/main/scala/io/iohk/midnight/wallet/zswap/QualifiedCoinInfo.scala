package io.iohk.midnight.wallet.zswap

opaque type QualifiedCoinInfo = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object QualifiedCoinInfo {
  extension (coin: QualifiedCoinInfo) {
    def tokenType: TokenType = ???
    def value: BigInt = ???
    def nonce: Nonce = ???
  }
}
