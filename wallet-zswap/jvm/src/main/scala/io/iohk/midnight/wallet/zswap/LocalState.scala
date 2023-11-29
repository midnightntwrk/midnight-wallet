package io.iohk.midnight.wallet.zswap

opaque type LocalState = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object LocalState {
  def deserialize(bytes: Array[Byte]): LocalState = ???

  def fromSeed(seed: Array[Byte]): LocalState = ???

  def apply(): LocalState = ???

  extension (localState: LocalState) {
    def serialize: Array[Byte] = ???

    def coins: List[QualifiedCoinInfo] = ???
    def availableCoins: List[QualifiedCoinInfo] = ???
    def coinPublicKey: CoinPublicKey = ???
    def encryptionSecretKey: EncryptionSecretKey = ???
    def encryptionPublicKey: EncryptionPublicKey = ???
    def watchFor(coin: CoinInfo): LocalState = ???
    def spend(coin: QualifiedCoinInfo): (LocalState, UnprovenInput) = ???
    @SuppressWarnings(Array("org.wartremover.warts.Overloading"))
    def apply(offer: Offer): LocalState = ???
    def applyProofErased(offer: ProofErasedOffer): LocalState = ???
    def applyFailed(offer: Offer): LocalState = ???
    def applyFailedProofErased(offer: ProofErasedOffer): LocalState = ???
    def pendingOutputs: List[CoinInfo] = ???
    def pendingOutputsSize: Int = ???
    def applyCollapsedUpdate(update: MerkleTreeCollapsedUpdate): LocalState = ???
    def firstFree: BigInt = ???
  }
}
