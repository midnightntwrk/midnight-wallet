package io.iohk.midnight.wallet.core

import cats.Eq
import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.zswap.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.util.WithProvingServerSuite

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
abstract class WalletSpec
    extends WalletKeysSpec[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey]
    with WalletBalancesSpec[Wallet]
    with WalletTxBalancingSpec[Wallet, Transaction, CoinInfo]
    with WalletTransactionProcessingSpec[Wallet, data.Transaction]
    with WithProvingServerSuite {

  private val zero = BigInt(0)

  override val walletKeys
      : WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] =
    Wallet.walletKeys
  private val defaultState = LocalState()
  override val walletWithKeys: Wallet = Wallet.walletCreation.create(defaultState)
  override val expectedCoinPubKey: CoinPublicKey = defaultState.coinPublicKey
  override val compareCoinPubKeys: (CoinPublicKey, CoinPublicKey) => Boolean = {
    given Eq[CoinPublicKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val expectedEncPubKey: EncryptionPublicKey = defaultState.encryptionPublicKey
  override val compareEncPubKeys: (EncryptionPublicKey, EncryptionPublicKey) => Boolean = {
    given Eq[EncryptionPublicKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val expectedViewingKey: EncryptionSecretKey = defaultState.encryptionSecretKey
  override val compareViewingKeys: (EncryptionSecretKey, EncryptionSecretKey) => Boolean = {
    given Eq[EncryptionSecretKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val walletBalances: WalletBalances[Wallet] = Wallet.walletBalances
  override val expectedBalance: BigInt = BigInt(100)
  override val walletWithBalances: Wallet =
    Wallet.walletCreation.create(
      Generators.generateStateWithFunds(NonEmptyList.one((TokenType.Native, expectedBalance))),
    )

  override val walletTxBalancing: WalletTxBalancing[Wallet, Transaction, CoinInfo] =
    Wallet.walletTxBalancing
  override val transactionToBalance: IO[Transaction] =
    Generators.ledgerTransactionArbitrary.arbitrary.sample.get
  private val imbalanceValue =
    transactionToBalance.map(_.imbalances(true).toList.headOption.map(_._2).getOrElse(zero))
  override val newCoins: Vector[CoinInfo] =
    Generators.generateCoinsFor(NonEmptyList.one((TokenType.Native, BigInt(100)))).toList.toVector
  override val walletWithFundsForBalancing: IO[Wallet] =
    imbalanceValue.map { value =>
      Wallet.walletCreation.create(
        Generators.generateStateWithFunds(
          NonEmptyList.one((TokenType.Native, value * value)),
        ),
      )
    }

  override val walletWithoutFundsForBalancing: Wallet = Wallet.walletCreation.create(defaultState)
//  override val isTransactionBalanced: Transaction => Boolean = tx =>
//    tx.imbalances(true).toList.head._2 >= zero

  override val walletTransactionProcessing: WalletTransactionProcessing[Wallet, data.Transaction] =
    Wallet.walletTransactionProcessing
  private val txWithContext = Generators.txWithContextArbitrary.arbitrary.sample.get
  override val walletForTransactions: IO[Wallet] =
    txWithContext.map(tx => Wallet.walletCreation.create(tx.state))
  override val validTransactionToApply: IO[data.Transaction] =
    txWithContext.map(tx => LedgerSerialization.toTransaction(tx.transaction))
  override val transactionToApplyWithBadFormatTx: data.Transaction =
    data.Transaction(data.Hash(""), "")
  override val isTransactionApplied: Wallet => Boolean = wallet =>
    Wallet.walletBalances.balance(wallet).getOrElse(TokenType.Native, zero) > zero
}
