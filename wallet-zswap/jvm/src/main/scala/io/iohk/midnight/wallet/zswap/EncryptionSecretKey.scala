package io.iohk.midnight.wallet.zswap

opaque type EncryptionSecretKey = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object EncryptionSecretKey {
  extension (key: EncryptionSecretKey) {
    def serialize: Array[Byte] = ???
    def test(offer: Offer): Boolean = ???
  }
}
