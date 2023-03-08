package io.iohk.midnight.wallet.core

import cats.syntax.eq.*
import io.iohk.midnight.midnightLedger.mod.{
  CoinInfo,
  Transaction,
  ZSwapCoinPublicKey,
  ZSwapLocalState,
}
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash}
import io.iohk.midnight.wallet.core.capabilities.*

import scala.scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
class WalletSpec
    extends WalletKeysSpec[Wallet, ZSwapCoinPublicKey]
    with WalletBalancesSpec[Wallet]
    with WalletTxBalancingSpec[Wallet, Transaction, CoinInfo]
    with WalletBlockProcessingSpec[Wallet, Block] {

  private val zero = js.BigInt(0)

  override val walletKeys: WalletKeys[Wallet, ZSwapCoinPublicKey] = Wallet.walletKeys
  private val defaultState = new ZSwapLocalState()
  override val walletWithKeys: Wallet = Wallet.walletCreation.create(defaultState)
  override val expectedKey: ZSwapCoinPublicKey = defaultState.coinPublicKey
  @SuppressWarnings(Array("org.wartremover.warts.ToString"))
  override val compareKeys: (ZSwapCoinPublicKey, ZSwapCoinPublicKey) => Boolean = (key1, key2) =>
    key1.toString === key2.toString

  override val walletBalances: WalletBalances[Wallet] = Wallet.walletBalances
  override val expectedBalance: js.BigInt = js.BigInt(100)
  override val walletWithBalances: Wallet =
    Wallet.walletCreation.create(Generators.generateStateWithFunds(expectedBalance))

  override val walletTxBalancing: WalletTxBalancing[Wallet, Transaction, CoinInfo] =
    Wallet.walletTxBalancing
  override val transactionToBalance: Transaction =
    Generators.ledgerTransactionGen.sample.get.transaction
  private val imbalanceValue =
    transactionToBalance.imbalances().headOption.map(_.imbalance).getOrElse(zero)
  override val newCoins: Vector[CoinInfo] = Generators.generateCoinsFor(js.BigInt(100)).toVector
  override val walletWithFundsForBalancing: Wallet =
    Wallet.walletCreation.create(Generators.generateStateWithFunds(imbalanceValue * imbalanceValue))
  override val walletWithoutFundsForBalancing: Wallet = Wallet.walletCreation.create(defaultState)
  override val isTransactionBalanced: Transaction => Boolean = tx =>
    tx.imbalances().pop().imbalance >= zero

  override val walletBlockProcessing: WalletBlockProcessing[Wallet, Block] =
    Wallet.walletBlockProcessing
  private val coin = Generators.coinInfoGen.sample.get
  private val (txToApply, watchingState) = Generators.buildTransaction(List(coin))
  override val walletForBlocks: Wallet = Wallet.walletCreation.create(watchingState)
  override val validBlockToApply: Block =
    Generators.blockGen(Seq(LedgerSerialization.toTransaction(txToApply))).sample.get
  private val badFormatTx = data.Transaction(data.Transaction.Header(Hash("")), "")
  override val blockToApplyWithBadFormatTx: Block = Generators.blockGen(Seq(badFormatTx)).sample.get
  override val isBlockApplied: Wallet => Boolean = wallet =>
    Wallet.walletBalances.balance(wallet) > zero
}
