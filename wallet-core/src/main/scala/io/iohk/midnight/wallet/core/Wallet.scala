package io.iohk.midnight.wallet.core

import cats.syntax.either.*
import cats.syntax.foldable.*
import cats.syntax.traverse.*
import io.iohk.midnight.js.interop.cats.Instances.bigIntSumMonoid as sum
import io.iohk.midnight.midnightLedger.mod.{
  CoinInfo,
  Transaction,
  ZSwapCoinPublicKey,
  ZSwapLocalState,
}
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.WalletError.BadTransactionFormat
import io.iohk.midnight.wallet.core.capabilities.*

final case class Wallet private (private val state: ZSwapLocalState)

object Wallet {

  implicit val walletCreation: WalletCreation[Wallet, ZSwapLocalState] =
    (initialState: ZSwapLocalState) => Wallet(initialState)

  implicit val walletBalances: WalletBalances[Wallet] = (wallet: Wallet) =>
    wallet.state.coins.toSeq.map(_.value).combineAll(sum)

  implicit val walletKeys: WalletKeys[Wallet, ZSwapCoinPublicKey] =
    (wallet: Wallet) => wallet.state.coinPublicKey

  implicit val walletTxBalancing: WalletTxBalancing[Wallet, Transaction, CoinInfo] =
    (wallet: Wallet, transactionWithCoins: (Transaction, Seq[CoinInfo])) =>
      TransactionBalancer
        .balanceTransaction(wallet.state, transactionWithCoins._1)
        .map { case (tx, state) =>
          transactionWithCoins._2.foreach(state.watchFor)
          (Wallet(state), tx)
        }
        .leftMap { case TransactionBalancer.NotSufficientFunds =>
          WalletError.NotSufficientFunds
        }

  implicit val walletBlockProcessing: WalletBlockProcessing[Wallet, Block] =
    (wallet: Wallet, block: Block) => {
      block.body.transactionResults
        .traverse(LedgerSerialization.fromTransaction(_).leftMap(BadTransactionFormat))
        .map { txs =>
          val state = wallet.state
          txs.foreach(tx => state.applyLocal(tx))
          Wallet(state)
        }
    }
}
