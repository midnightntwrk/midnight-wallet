package io.iohk.midnight.wallet.blockchain.data

sealed trait IndexerEvent

object IndexerEvent {
  case object ConnectionLost extends IndexerEvent

  sealed trait RawIndexerUpdate extends IndexerEvent {
    def legacyIndexer: Boolean
  }

  final case class RawProgressUpdate(synced: BigInt, total: BigInt, legacyIndexer: Boolean)
      extends RawIndexerUpdate

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
      legacyIndexer: Boolean,
  ) extends RawIndexerUpdate
}
