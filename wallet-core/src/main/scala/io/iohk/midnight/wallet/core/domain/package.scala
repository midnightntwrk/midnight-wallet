package io.iohk.midnight.wallet.core

import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core.combinator.ProtocolVersion
import io.iohk.midnight.wallet.zswap.{
  MerkleTreeCollapsedUpdate,
  TokenType,
  Transaction,
  UnprovenTransaction,
}

package object domain {
  final case class Address(address: String) extends AnyVal

  sealed trait ProvingRecipe {
    def unprovenTransaction: Option[UnprovenTransaction]
  }
  sealed trait BalanceTransactionRecipe extends ProvingRecipe

  final case class TransactionToProve(transaction: UnprovenTransaction) extends ProvingRecipe {
    override def unprovenTransaction: Option[UnprovenTransaction] = Some(transaction)
  }
  final case class BalanceTransactionToProve(toProve: UnprovenTransaction, toBalance: Transaction)
      extends BalanceTransactionRecipe {
    override def unprovenTransaction: Option[UnprovenTransaction] = Some(toProve)
  }
  final case class NothingToProve(transaction: Transaction) extends BalanceTransactionRecipe {
    override def unprovenTransaction: Option[UnprovenTransaction] = None
  }

  final case class TokenTransfer(amount: BigInt, tokenType: TokenType, receiverAddress: Address)

  final case class TransactionHash(hash: String) extends AnyVal

  final case class TransactionIdentifier(txId: String) extends AnyVal

  enum ApplyStage {
    case FailEntirely, FailFallible, SucceedEntirely
  }

  final case class AppliedTransaction(tx: Transaction, applyStage: ApplyStage)

  sealed trait IndexerUpdate {
    def protocolVersion: ProtocolVersion = ProtocolVersion.V1
  }

  final case class ViewingUpdate(
      offset: Offset,
      updates: Seq[Either[MerkleTreeCollapsedUpdate, AppliedTransaction]],
  ) extends IndexerUpdate

  final case class ProgressUpdate(synced: Option[Offset], total: Option[Offset])
      extends IndexerUpdate
  object ProgressUpdate {
    def apply(synced: Offset, total: Offset): ProgressUpdate =
      new ProgressUpdate(Some(synced), Some(total))
    def empty: ProgressUpdate =
      new ProgressUpdate(None, None)
  }

  case object ConnectionLost extends IndexerUpdate

  final case class Seed(seed: Array[Byte]) extends AnyVal
}
