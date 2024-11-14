package io.iohk.midnight.wallet.core

import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset

package object domain {
  final case class Address(address: String) extends AnyVal

  sealed trait ProvingRecipe[+UnprovenTransaction, +Transaction] {
    def unprovenTransaction: Option[UnprovenTransaction]
  }
  sealed trait BalanceTransactionRecipe[UnprovenTransaction, Transaction]
      extends ProvingRecipe[UnprovenTransaction, Transaction]

  final case class TransactionToProve[UnprovenTransaction](transaction: UnprovenTransaction)
      extends ProvingRecipe[UnprovenTransaction, Nothing] {
    override def unprovenTransaction: Option[UnprovenTransaction] = Some(transaction)
  }
  final case class BalanceTransactionToProve[UnprovenTransaction, Transaction](
      toProve: UnprovenTransaction,
      toBalance: Transaction,
  ) extends BalanceTransactionRecipe[UnprovenTransaction, Transaction] {
    override def unprovenTransaction: Option[UnprovenTransaction] = Some(toProve)
  }
  final case class NothingToProve[UnprovenTransaction, Transaction](transaction: Transaction)
      extends BalanceTransactionRecipe[UnprovenTransaction, Transaction] {
    override def unprovenTransaction: Option[UnprovenTransaction] = None
  }

  final case class TokenTransfer[TokenType](
      amount: BigInt,
      tokenType: TokenType,
      receiverAddress: Address,
  )

  final case class TransactionIdentifier(txId: String) extends AnyVal

  enum ApplyStage {
    case FailEntirely, FailFallible, SucceedEntirely
  }

  final case class AppliedTransaction[Transaction](tx: Transaction, applyStage: ApplyStage)

  sealed trait IndexerUpdate[+MerkleTreeCollapsedUpdate, +Transaction]

  final case class ViewingUpdate[MerkleTreeCollapsedUpdate, Transaction](
      protocolVersion: ProtocolVersion,
      offset: Offset,
      updates: Seq[Either[MerkleTreeCollapsedUpdate, AppliedTransaction[Transaction]]],
  ) extends IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]

  final case class ProgressUpdate(synced: Option[Offset], total: Option[Offset])
      extends IndexerUpdate[Nothing, Nothing]
  object ProgressUpdate {
    def apply(synced: Offset, total: Offset): ProgressUpdate =
      new ProgressUpdate(Some(synced), Some(total))
    def empty: ProgressUpdate =
      new ProgressUpdate(None, None)
  }

  case object ConnectionLost extends IndexerUpdate[Nothing, Nothing]

  final case class Seed(seed: Array[Byte]) extends AnyVal
}
