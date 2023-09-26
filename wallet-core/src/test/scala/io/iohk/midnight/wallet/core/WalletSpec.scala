package io.iohk.midnight.wallet.core

import io.iohk.midnight.wallet.zswap.{CoinInfo, CoinPublicKey, EncryptionSecretKey, Transaction}
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.capabilities.*

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
abstract class WalletSpec
    extends WalletKeysSpec[Wallet, CoinPublicKey, EncryptionSecretKey]
    with WalletBalancesSpec[Wallet]
    with WalletTxBalancingSpec[Wallet, Transaction, CoinInfo]
    with WalletTransactionProcessingSpec[Wallet, data.Transaction] {

  // TEMPORARY IGNORED SPEC UNTIL HAVING ALL NEW WALLET CAPABILITIES IMPLEMENTED

  /*  private val zero = js.BigInt(0)

  override val walletKeys: WalletKeys[Wallet, CoinPublicKey] = Wallet.walletKeys
  private val defaultState = new LocalState()
  override val walletWithKeys: Wallet = Wallet.walletCreation.create(defaultState)
  override val expectedKey: CoinPublicKey = defaultState.coinPublicKey
  @SuppressWarnings(Array("org.wartremover.warts.ToString"))
  override val compareKeys: (CoinPublicKey, CoinPublicKey) => Boolean = (key1, key2) =>
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
    transactionToBalance.imbalances(true).toList.headOption.map(_._2).getOrElse(zero)
  override val newCoins: Vector[CoinInfo] = Generators.generateCoinsFor(js.BigInt(100)).toVector
  override val walletWithFundsForBalancing: Wallet =
    Wallet.walletCreation.create(Generators.generateStateWithFunds(imbalanceValue * imbalanceValue))
  override val walletWithoutFundsForBalancing: Wallet = Wallet.walletCreation.create(defaultState)
  override val isTransactionBalanced: Transaction => Boolean = tx =>
    tx.imbalances(true).toList.head._2 >= zero

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
    Wallet.walletBalances.balance(wallet) > zero*/
}
