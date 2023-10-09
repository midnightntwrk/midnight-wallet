package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Transaction as WalletTransaction
import io.iohk.midnight.wallet.core.TransactionBalancer.BalanceTransactionResult
import io.iohk.midnight.wallet.core.WalletError.BadTransactionFormat
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  BalanceTransactionToProve,
  NothingToProve,
  Seed,
  TokenTransfer,
  TransactionToProve,
  ViewingUpdate,
}
import io.iohk.midnight.wallet.zswap.*
import scala.util.Try

final case class Wallet private (private val state: LocalState, txHistory: Vector[Transaction])

object Wallet {

  implicit val walletCreation: WalletCreation[Wallet, LocalState] =
    (initialState: LocalState) => Wallet(initialState, Vector.empty)

  implicit val walletRestore: WalletRestore[Wallet, Seed] =
    (input: Seed) => new Wallet(LocalState.fromSeed(input.seed), Vector.empty)

  implicit val walletBalances: WalletBalances[Wallet] = (wallet: Wallet) =>
    wallet.state.coins.groupMapReduce(_.tokenType)(_.value)(_ + _)

  implicit val walletKeys
      : WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] =
    new WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] {
      override def coinPublicKey(wallet: Wallet): CoinPublicKey =
        wallet.state.coinPublicKey
      override def encryptionPublicKey(wallet: Wallet): EncryptionPublicKey =
        wallet.state.encryptionPublicKey
      override def viewingKey(wallet: Wallet): EncryptionSecretKey =
        wallet.state.encryptionSecretKey
    }

  implicit val walletCoins: WalletCoins[Wallet] =
    new WalletCoins[Wallet] {
      override def coins(wallet: Wallet): Seq[QualifiedCoinInfo] =
        wallet.state.coins
      override def availableCoins(wallet: Wallet): Seq[QualifiedCoinInfo] =
        wallet.state.coins.filterNot(wallet.state.pendingSpends.contains)
    }

  implicit val walletTxBalancing: WalletTxBalancing[Wallet, Transaction, CoinInfo] =
    new WalletTxBalancing[Wallet, Transaction, CoinInfo] {
      override def prepareTransferRecipe(
          wallet: Wallet,
          outputs: List[TokenTransfer],
      ): Either[WalletError, (Wallet, TransactionToProve)] = {
        val offers = outputs.filter(_.amount > BigInt(0)).traverse { tt =>
          Address
            .fromString(tt.receiverAddress.address)
            .map { address =>
              val output = UnprovenOutput(
                CoinInfo(tt.tokenType, tt.amount),
                address.coinPublicKey,
                address.encryptionPublicKey,
              )
              UnprovenOffer.fromOutput(output, tt.tokenType, tt.amount)
            }
            .toEither
            .leftMap(WalletError.InvalidAddress.apply)
        }

        offers.flatMap(_.reduceLeftOption(_.merge(_)) match
          case Some(offerToBalance) =>
            TransactionBalancer
              .balanceOffer(wallet.state, offerToBalance)
              .map { case (balancedOffer, newState) =>
                (
                  Wallet(newState, wallet.txHistory),
                  TransactionToProve(UnprovenTransaction(balancedOffer)),
                )
              }
              .leftMap { case TransactionBalancer.NotSufficientFunds(error) =>
                WalletError.NotSufficientFunds(error)
              }
          case None =>
            Left(WalletError.NoTokenTransfers),
        )
      }

      override def balanceTransaction(
          wallet: Wallet,
          transactionWithCoins: (Transaction, Seq[CoinInfo]),
      ): Either[WalletError, (Wallet, BalanceTransactionRecipe)] = {
        val (transactionToBalance, coins) = transactionWithCoins
        TransactionBalancer
          .balanceTransaction(wallet.state, transactionToBalance)
          .map {
            case BalanceTransactionResult.BalancedTransactionAndState(unprovenTx, state) =>
              coins.foreach(state.watchFor)
              (
                Wallet(state, wallet.txHistory),
                BalanceTransactionToProve(unprovenTx, transactionToBalance),
              )
            case BalanceTransactionResult.ReadyTransactionAndState(tx, state) =>
              coins.foreach(state.watchFor)
              (Wallet(state, wallet.txHistory), NothingToProve(tx))
          }
          .leftMap { case TransactionBalancer.NotSufficientFunds(error) =>
            WalletError.NotSufficientFunds(error)
          }
      }
    }

  implicit val walletTransactionProcessing: WalletTransactionProcessing[Wallet, WalletTransaction] =
    (wallet: Wallet, transaction: WalletTransaction) => {
      LedgerSerialization
        .fromTransaction(transaction)
        .leftMap[WalletError](BadTransactionFormat.apply)
        .mproduct(isRelevant(wallet, _).toEither.leftMap(WalletError.LedgerExecutionError.apply))
        .map { (tx, relevant) =>
          val updatedState = applyTransaction(wallet.state, tx)
          val newTx = Option.when(relevant)(tx)
          Wallet(updatedState, wallet.txHistory ++ newTx)
        }
    }

  private def isRelevant(wallet: Wallet, tx: Transaction): Try[Boolean] =
    wallet.state.encryptionSecretKey.test(tx)

  implicit val walletSync: WalletSync[Wallet, ViewingUpdate] =
    (wallet: Wallet, update: ViewingUpdate) => {
      val stateWithMTUpdated = wallet.state.applyCollapsedUpdate(update.merkleTreeUpdate)
      val stateWithAppliedTxs = update.transactionDiff.foldLeft(stateWithMTUpdated) {
        case (state, transaction) =>
          applyTransaction(state, transaction)
      }
      val newTxs = update.transactionDiff
        .filterA(isRelevant(wallet, _))
        .toEither
        .leftMap(WalletError.LedgerExecutionError.apply)
      newTxs.map(txs => Wallet(stateWithAppliedTxs, wallet.txHistory ++ txs))
    }

  // TODO use information about fallible execution success to apply fallible offer
  private def applyTransaction(state: LocalState, transaction: Transaction): LocalState =
    transaction.fallibleCoins match {
      case Some(offer) =>
        state.apply(transaction.guaranteedCoins).apply(offer)
      case None =>
        state.apply(transaction.guaranteedCoins)
    }
}
