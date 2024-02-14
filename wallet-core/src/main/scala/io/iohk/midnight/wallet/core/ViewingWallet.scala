package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Transaction as WalletTransaction
import io.iohk.midnight.wallet.core.WalletError.{BadTransactionFormat, LedgerExecutionError}
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.{
  AppliedTransaction,
  ApplyStage,
  TransactionHash,
  ViewingUpdate,
}
import io.iohk.midnight.wallet.zswap.*

final case class ViewingWallet private (
    coinPublicKey: CoinPublicKey,
    encryptionPublicKey: EncryptionPublicKey,
    viewingKey: EncryptionSecretKey,
    transactions: Vector[Transaction],
    progress: Option[domain.ProgressUpdate],
) {
  def prepareUpdate(
      lastKnownHash: Option[TransactionHash],
      chainState: ZswapChainState,
      start: BigInt,
  ): ViewingUpdate =
    ViewingUpdate(
      WalletTransaction.Offset.Zero,
      lastKnownHash
        .fold(transactions)(hash => transactions.dropWhile(_.hash =!= hash.hash))
        .map(AppliedTransaction(_, ApplyStage.SucceedEntirely).asRight) ++
        Seq(MerkleTreeCollapsedUpdate(chainState, start, chainState.firstFree - BigInt(1)).asLeft),
    )
}

object ViewingWallet {
  given WalletRestore[ViewingWallet, (CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)] =
    (coinPubKey, encPubKey, encSecKey) =>
      new ViewingWallet(coinPubKey, encPubKey, encSecKey, Vector.empty, None)

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

  given WalletTxHistory[ViewingWallet, Transaction] =
    new WalletTxHistory[ViewingWallet, Transaction] {
      override def transactionHistory(wallet: ViewingWallet): Seq[Transaction] =
        wallet.transactions
      override def progress(wallet: ViewingWallet): Option[domain.ProgressUpdate] =
        wallet.progress
    }
}
