package io.iohk.midnight.wallet.core

import cats.syntax.either.*
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.Transaction as WalletTransaction
import io.iohk.midnight.wallet.core.WalletError.BadTransactionFormat
import io.iohk.midnight.wallet.core.capabilities.{WalletRestore, WalletSync}
import io.iohk.midnight.wallet.core.domain.{TransactionHash, ViewingUpdate}
import io.iohk.midnight.wallet.zswap.{
  EncryptionSecretKey,
  MerkleTreeCollapsedUpdate,
  Transaction,
  ZswapChainState,
}
import scala.annotation.tailrec

final case class ViewingWallet private (
    viewingKey: EncryptionSecretKey,
    transactions: Vector[Transaction],
) {
  def prepareUpdate(
      lastKnownTxHash: Option[TransactionHash],
      startIndex: BigInt,
      chainState: ZswapChainState,
  ): ViewingUpdate = {
    val newTxs = lastKnownTxHash match
      case Some(hash) =>
        findTransactionsDiff(transactions, hash)
      case None => transactions

    ViewingUpdate(
      MerkleTreeCollapsedUpdate(chainState, startIndex, chainState.firstFree - BigInt(1)),
      newTxs,
    )
  }

  @tailrec
  private def findTransactionsDiff(
      transactions: Vector[Transaction],
      lastKnownTxHash: TransactionHash,
  ): Vector[Transaction] = {
    transactions match
      case head +: tail =>
        if (head.hash === lastKnownTxHash.hash) tail
        else findTransactionsDiff(tail, lastKnownTxHash)
      case _ =>
        Vector.empty[Transaction]
  }
}

object ViewingWallet {
  given WalletRestore[ViewingWallet, EncryptionSecretKey] = (input: EncryptionSecretKey) =>
    new ViewingWallet(input, Vector.empty)

  given WalletSync[ViewingWallet, WalletTransaction] =
    (wallet: ViewingWallet, update: WalletTransaction) => {
      LedgerSerialization.fromTransaction(update).leftMap(BadTransactionFormat.apply).map { tx =>
        // TODO use information about fallible execution success
        // test(guaranteed) || (test(fallible) && fallible_success)
        if (
          wallet.viewingKey.test(tx.guaranteedCoins) || tx.fallibleCoins
            .exists(wallet.viewingKey.test)
        ) {
          wallet.copy(transactions = wallet.transactions.appended(tx))
        } else wallet
      }
    }
}
