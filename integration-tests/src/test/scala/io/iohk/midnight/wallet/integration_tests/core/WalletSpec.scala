package io.iohk.midnight.wallet.integration_tests.core

import cats.Eq
import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.{Generators, Wallet}
import io.iohk.midnight.wallet.core.domain.{
  AppliedTransaction,
  ApplyStage,
  IndexerUpdate,
  ViewingUpdate,
}
import io.iohk.midnight.wallet.integration_tests.core.capabilities.*
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
abstract class WalletSpec
    extends WalletKeysSpec[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey]
    with WalletBalancesSpec[Wallet]
    with WalletTxBalancingSpec[Wallet, Transaction, UnprovenTransaction, CoinInfo]
    with WalletSyncSpec[Wallet, IndexerUpdate]
    with WithProvingServerSuite {

  private val zero = BigInt(0)

  given WalletTxHistory[Wallet, Transaction] = Wallet.walletDiscardTxHistory
  given networkId: NetworkId = NetworkId.Undeployed

  override val walletKeys
      : WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] =
    Wallet.walletKeys
  private val defaultState = Wallet.Snapshot.create
  override val walletWithKeys: Wallet = Wallet.walletCreation.create(defaultState)
  override val expectedCoinPubKey: CoinPublicKey = defaultState.state.coinPublicKey
  override val compareCoinPubKeys: (CoinPublicKey, CoinPublicKey) => Boolean = {
    given Eq[CoinPublicKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val expectedEncPubKey: EncryptionPublicKey = defaultState.state.encryptionPublicKey
  override val compareEncPubKeys: (EncryptionPublicKey, EncryptionPublicKey) => Boolean = {
    given Eq[EncryptionPublicKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val expectedViewingKey: EncryptionSecretKey = defaultState.state.encryptionSecretKey
  override val compareViewingKeys: (EncryptionSecretKey, EncryptionSecretKey) => Boolean = {
    given Eq[EncryptionSecretKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val walletBalances: WalletBalances[Wallet] = Wallet.walletBalances
  override val expectedBalance: BigInt = BigInt(100)
  override val walletWithBalances: Wallet =
    Wallet.walletCreation.create(
      Wallet.Snapshot(
        Generators.generateStateWithFunds(NonEmptyList.one((TokenType.Native, expectedBalance))),
        Seq.empty,
        None,
        ProtocolVersion.V1,
        networkId,
      ),
    )

  override val walletTxBalancing
      : WalletTxBalancing[Wallet, Transaction, UnprovenTransaction, CoinInfo] =
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
        Wallet.Snapshot(
          Generators.generateStateWithFunds(
            NonEmptyList.one((TokenType.Native, value * value)),
          ),
          Seq.empty,
          None,
          ProtocolVersion.V1,
          networkId,
        ),
      )
    }

  override val walletWithoutFundsForBalancing: Wallet = Wallet.walletCreation.create(defaultState)

  override val walletSync: WalletSync[Wallet, IndexerUpdate] = Wallet.walletSync
  private val txWithContext =
    Generators.txWithContextArbitrary.arbitrary.sample.get.fproduct { tx =>
      val state = ZswapChainState()
      tx.transaction.guaranteedCoins.fold(state)(state.tryApply)
    }
  override val walletForUpdates: IO[Wallet] =
    txWithContext.map((tx, _) =>
      Wallet.walletCreation.create(
        Wallet.Snapshot(tx.state, Seq(tx.transaction), None, ProtocolVersion.V1, networkId),
      ),
    )
  override val validUpdateToApply: IO[IndexerUpdate] =
    txWithContext.map { (txCtx, chainState) =>
      ViewingUpdate(
        ProtocolVersion.V1,
        data.Transaction.Offset.Zero,
        Seq(
          Left(MerkleTreeCollapsedUpdate(chainState, BigInt(0), BigInt(1), ProtocolVersion.V1)),
          Right(AppliedTransaction(txCtx.transaction, ApplyStage.SucceedEntirely)),
        ),
      )
    }
  override val isUpdateApplied: Wallet => Boolean = wallet =>
    Wallet.walletBalances.balance(wallet).getOrElse(TokenType.Native, zero) > zero
}
