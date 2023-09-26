package io.iohk.midnight.wallet.zswap

opaque type MerkleTreeCollapsedUpdate = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object MerkleTreeCollapsedUpdate {
  def apply(
      zswapChainState: ZswapChainState,
      startIndex: BigInt,
      endIndex: BigInt,
  ): MerkleTreeCollapsedUpdate = ???
}
