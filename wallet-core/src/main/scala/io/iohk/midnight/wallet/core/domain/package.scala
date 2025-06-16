package io.iohk.midnight.wallet.core

import cats.implicits.catsSyntaxEq
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset

import scala.scalajs.js.annotation.{JSExport, JSExportAll}

package object domain {
  final case class Address[CoinPublicKey, EncryptionPublicKey](
      coinPublicKey: CoinPublicKey,
      encryptionPublicKey: EncryptionPublicKey,
  )

  sealed trait ProvingRecipe[+UnprovenTransaction, +Transaction] {
    def unprovenTransaction: Option[UnprovenTransaction]
  }
  sealed trait BalanceTransactionRecipe[UnprovenTransaction, Transaction]
      extends ProvingRecipe[UnprovenTransaction, Transaction]

  final case class TransactionToProve[UnprovenTransaction](transaction: UnprovenTransaction)
      extends BalanceTransactionRecipe[UnprovenTransaction, Nothing] {
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

  @JSExportAll
  final case class TokenTransfer[TokenType, CoinPublicKey, EncryptionPublicKey](
      amount: BigInt,
      tokenType: TokenType,
      receiverAddress: Address[CoinPublicKey, EncryptionPublicKey],
  )

  final case class TransactionIdentifier(txId: String) extends AnyVal

  @JSExportAll
  enum ApplyStage {
    case FailEntirely, FailFallible, SucceedEntirely
  }

  @JSExportAll
  final case class AppliedTransaction[Transaction](tx: Transaction, applyStage: ApplyStage)

  @JSExportAll sealed trait IndexerUpdate[+MerkleTreeCollapsedUpdate, +Transaction]

  @JSExportAll final case class ViewingUpdate[MerkleTreeCollapsedUpdate, Transaction](
      protocolVersion: ProtocolVersion,
      offset: Offset,
      updates: Seq[Either[MerkleTreeCollapsedUpdate, AppliedTransaction[Transaction]]],
  ) extends IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]

  @JSExportAll final case class ProgressUpdate(
      appliedIndex: Option[Offset],
      highestRelevantWalletIndex: Option[Offset],
      highestIndex: Option[Offset],
      highestRelevantIndex: Option[Offset],
  ) extends IndexerUpdate[Nothing, Nothing] {
    lazy val isComplete: Boolean =
      (appliedIndex, highestRelevantWalletIndex, highestIndex, highestRelevantIndex) match
        case (_, Some(hrw), Some(hi), Some(hri)) => {
          val ai = appliedIndex.getOrElse(Offset.Zero)
          val applyGap = (hrw.value - ai.value).abs
          val sourceGap = (hi.value - hri.value).abs
          applyGap === BigInt(0) && sourceGap <= BigInt(50)
        }
        case _ => false
  }

  @JSExportAll object ProgressUpdate {
    @JSExport("apply") def apply(
        appliedIndex: Offset,
        highestRelevantWalletIndex: Offset,
        highestIndex: Offset,
        highestRelevantIndex: Offset,
    ): ProgressUpdate =
      new ProgressUpdate(
        Some(appliedIndex),
        Some(highestRelevantWalletIndex),
        Some(highestIndex),
        Some(highestRelevantIndex),
      )
    def empty: ProgressUpdate =
      new ProgressUpdate(None, None, None, None)
  }

  @JSExportAll case object ConnectionLost extends IndexerUpdate[Nothing, Nothing]

  final case class Seed(seed: Array[Byte]) extends AnyVal
}
