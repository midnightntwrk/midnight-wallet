package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Transaction as WalletTransaction
import io.iohk.midnight.wallet.core.WalletError.{BadTransactionFormat, LedgerExecutionError}
import io.iohk.midnight.wallet.core.capabilities.{WalletKeys, WalletRestore, WalletSync}
import io.iohk.midnight.wallet.core.domain.{TransactionHash, ViewingUpdate}
import io.iohk.midnight.wallet.zswap.*
import scala.annotation.tailrec

final case class ViewingWallet private (
    coinPublicKey: CoinPublicKey,
    encryptionPublicKey: EncryptionPublicKey,
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
  given WalletRestore[ViewingWallet, (CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)] =
    (coinPubKey, encPubKey, encSecKey) =>
      new ViewingWallet(coinPubKey, encPubKey, encSecKey, Vector.empty)

  given WalletKeys[ViewingWallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] =
    new WalletKeys[ViewingWallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] {
      override def coinPublicKey(wallet: ViewingWallet): CoinPublicKey =
        wallet.coinPublicKey
      override def encryptionPublicKey(wallet: ViewingWallet): EncryptionPublicKey =
        wallet.encryptionPublicKey
      override def viewingKey(wallet: ViewingWallet): EncryptionSecretKey =
        wallet.viewingKey
    }

  given WalletSync[ViewingWallet, WalletTransaction] =
    (wallet: ViewingWallet, update: WalletTransaction) => {
      LedgerSerialization
        .fromTransaction(update)
        .leftMap[WalletError](BadTransactionFormat.apply)
        .mproduct(wallet.viewingKey.test(_).toEither.leftMap(LedgerExecutionError.apply))
        .map { (tx, isRelevant) =>
          if (isRelevant) wallet.copy(transactions = wallet.transactions.appended(tx))
          else wallet
        }
    }
}
