package io.iohk.midnight.wallet.blockchain.data

sealed trait IndexerEvent

object IndexerEvent {
  case object ConnectionLost extends IndexerEvent

  sealed trait RawIndexerUpdate extends IndexerEvent

  final case class RawProgressUpdate(
      highestIndex: BigInt,
      highestRelevantIndex: BigInt,
      highestRelevantWalletIndex: BigInt,
  ) extends RawIndexerUpdate

  sealed trait SingleUpdate {
    def protocolVersion: ProtocolVersion
  }

  case object SingleUpdate {
    final case class RawTransaction(
        protocolVersion: ProtocolVersion,
        hash: String,
        raw: String,
        applyStage: String,
    ) extends SingleUpdate
    final case class MerkleTreeCollapsedUpdate(protocolVersion: ProtocolVersion, update: String)
        extends SingleUpdate
  }

  final case class RawViewingUpdate(
      index: BigInt,
      updates: Seq[SingleUpdate],
  ) extends RawIndexerUpdate
}
