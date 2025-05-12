package io.iohk.midnight.wallet.integration_tests.core

import cats.Eq
import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.{
  Generators,
  Snapshot,
  SnapshotInstances,
  WalletInstances,
  Wallet as CoreWallet,
}
import io.iohk.midnight.wallet.core.domain.{
  AppliedTransaction,
  ApplyStage,
  ViewingUpdate,
  IndexerUpdate as CoreIndexerUpdate,
}
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.wallet.integration_tests.core.capabilities.*
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.given
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import scalajs.js

private type Wallet = CoreWallet[LocalState, SecretKeys, Transaction]
private type IndexerUpdate = CoreIndexerUpdate[MerkleTreeCollapsedUpdate, Transaction]

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial", "org.wartremover.warts.TryPartial"))
abstract class WalletSpec
    extends WalletKeysSpec[Wallet, CoinPublicKey, EncPublicKey, EncryptionSecretKey]
    with WalletBalancesSpec[Wallet, TokenType]
    with WalletTxBalancingSpec[
      Wallet,
      Transaction,
      UnprovenTransaction,
      CoinInfo,
      TokenType,
      CoinPublicKey,
      EncPublicKey,
    ]
    with WalletSyncSpec[Wallet, IndexerUpdate]
    with WithProvingServerSuite {

  private val zero = js.BigInt(0)

  private given snapshots: SnapshotInstances[LocalState, Transaction] =
    new SnapshotInstances
  private val walletInstances =
    new WalletInstances[
      LocalState,
      SecretKeys,
      Transaction,
      TokenType,
      Offer,
      ProofErasedTransaction,
      QualifiedCoinInfo,
      CoinInfo,
      Nullifier,
      CoinPublicKey,
      EncryptionSecretKey,
      EncPublicKey,
      CoinSecretKey,
      UnprovenInput,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
      UnprovenTransaction,
      UnprovenOffer,
      UnprovenOutput,
    ]

  given WalletTxHistory[Wallet, Transaction] = walletInstances.walletDiscardTxHistory
  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  override val walletKeys: WalletKeys[Wallet, CoinPublicKey, EncPublicKey, EncryptionSecretKey] =
    walletInstances.walletKeys
  private val defaultState = snapshots.create
  val seed = zswap.HexUtil.decodeHex(zswap.HexUtil.randomHex()).get
  override val walletWithKeys: Wallet = walletInstances.walletCreation.create(seed, defaultState)

  override val expectedViewingKey: EncryptionSecretKey =
    walletWithKeys.secretKeys.encryptionSecretKey
  override val compareViewingKeys: (EncryptionSecretKey, EncryptionSecretKey) => Boolean = {
    given Eq[EncryptionSecretKey] = Eq.fromUniversalEquals
    (key1, key2) => key1 === key2
  }

  override val walletBalances: WalletBalances[Wallet, TokenType] = walletInstances.walletBalances
  override val expectedBalance: BigInt = BigInt(100)
  override val walletWithBalances: Wallet = {
    val seedHex = zswap.HexUtil.randomHex();
    val seed = zswap.HexUtil.decodeHex(seedHex).get
    val state: (LocalState, SecretKeys) =
      Generators.generateStateWithFunds(
        NonEmptyList.one((nativeToken(), expectedBalance)),
        Some(seedHex),
      )

    walletInstances.walletCreation.create(
      seed,
      Snapshot[LocalState, Transaction](
        state._1,
        Seq.empty,
        None,
        ProtocolVersion.V1,
        networkId,
      ),
    )
  }

  override val walletTxBalancing
      : WalletTxBalancing[Wallet, Transaction, UnprovenTransaction, CoinInfo] =
    walletInstances.walletTxBalancing
  override val transactionToBalance: IO[Transaction] =
    Generators.ledgerTransactionArbitrary.arbitrary.sample.get
  private val imbalanceValue =
    transactionToBalance.map(_.imbalances(true).toList.headOption.map(_._2).getOrElse(zero))
  override val newCoins: Vector[CoinInfo] =
    Generators.generateCoinsFor(NonEmptyList.one((nativeToken(), BigInt(100)))).toList.toVector
  override val walletWithFundsForBalancing: IO[Wallet] =
    imbalanceValue.map { value =>
      val seedHex = zswap.HexUtil.randomHex()
      val seed = zswap.HexUtil.decodeHex(seedHex).get
      val state: (LocalState, SecretKeys) =
        Generators.generateStateWithFunds(
          NonEmptyList.one((nativeToken(), expectedBalance)),
          Some(seedHex),
        )

      walletInstances.walletCreation.create(
        seed,
        Snapshot[LocalState, Transaction](
          state._1,
          Seq.empty,
          None,
          ProtocolVersion.V1,
          networkId,
        ),
      )
    }

  override val walletWithoutFundsForBalancing: Wallet =
    walletInstances.walletCreation.create(
      zswap.HexUtil.decodeHex(zswap.HexUtil.randomHex()).get,
      defaultState,
    )

  override val walletSync: WalletSync[Wallet, IndexerUpdate] = walletInstances.walletSync
  private val txWithContext: IO[(Generators.TransactionWithContext, ZswapChainState)] =
    Generators.txWithContextArbitrary.arbitrary.sample.get.fproduct { tx =>
      val state = ZswapChainState()
      tx.transaction.guaranteedCoins.fold(state)(state.tryApply(_)._1)
    }
  override val walletForUpdates: IO[Wallet] =
    txWithContext.map((tx, _) =>
      walletInstances.walletCreation.create(
        zswap.HexUtil.decodeHex(zswap.HexUtil.randomHex()).get,
        Snapshot(tx.state, Seq(tx.transaction), None, ProtocolVersion.V1, networkId),
      ),
    )
  override val validUpdateToApply: IO[IndexerUpdate] =
    txWithContext.map { (txCtx, chainState) =>
      ViewingUpdate(
        ProtocolVersion.V1,
        data.Transaction.Offset.Zero,
        Seq(
          Left(MerkleTreeCollapsedUpdate(chainState, js.BigInt(0), js.BigInt(1))),
          Right(AppliedTransaction(txCtx.transaction, ApplyStage.SucceedEntirely)),
        ),
      )
    }
  override val isUpdateApplied: Wallet => Boolean = wallet =>
    walletInstances.walletBalances
      .balance(wallet)
      .getOrElse(nativeToken(), zero.toScalaBigInt) > zero.toScalaBigInt
}
