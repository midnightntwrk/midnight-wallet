package io.iohk.midnight.wallet.core

import cats.implicits.catsSyntaxEq
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset

import scala.scalajs.js.annotation.{JSExport, JSExportAll}

package object domain {
  @JSExportAll final case class Address(address: String) extends AnyVal

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

  @JSExportAll sealed trait IndexerUpdate[+MerkleTreeCollapsedUpdate, +Transaction]

  @JSExportAll final case class ViewingUpdate[MerkleTreeCollapsedUpdate, Transaction](
      protocolVersion: ProtocolVersion,
      offset: Offset,
      updates: Seq[Either[MerkleTreeCollapsedUpdate, AppliedTransaction[Transaction]]],
  ) extends IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]

  @JSExportAll final case class ProgressUpdate(synced: Option[Offset], total: Option[Offset])
      extends IndexerUpdate[Nothing, Nothing] {
    lazy val isComplete: Boolean = (synced, total) match
      case (Some(s), Some(t)) => s === t
      case _                  => false
  }

  @JSExportAll object ProgressUpdate {
    @JSExport("apply") def apply(synced: Offset, total: Offset): ProgressUpdate =
      new ProgressUpdate(Some(synced), Some(total))
    def empty: ProgressUpdate =
      new ProgressUpdate(None, None)
  }

  @JSExportAll case object ConnectionLost extends IndexerUpdate[Nothing, Nothing]

  final case class Seed(seed: Array[Byte]) extends AnyVal
}
