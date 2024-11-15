package io.iohk.midnight.wallet.integration_tests.core

import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.core.{
  Generators,
  Snapshot,
  SnapshotInstances,
  WalletInstances,
  WalletQueryStateService,
  WalletStateContainer,
  WalletStateService,
  WalletStateServiceFactory,
  Wallet as CoreWallet,
}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.wallet.zswap.given
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF
import scalajs.js

class WalletStateServiceSpec
    extends ScalaCheckEffectSuite
    with BetterOutputSuite
    with WithProvingServerSuite {

  private given snapshots: SnapshotInstances[LocalState, Transaction] = new SnapshotInstances
  private val wallets: WalletInstances[
    LocalState,
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
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
  ] = new WalletInstances

  import wallets.given

  type Wallet = CoreWallet[LocalState, Transaction]

  def buildWalletStateService(
      initialState: LocalState = LocalState(),
  ): Resource[IO, WalletStateService[
    CoinPublicKey,
    EncPublicKey,
    EncryptionSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
  ]] = {
    val snapshot = Snapshot[LocalState, Transaction](
      initialState,
      Seq.empty,
      None,
      ProtocolVersion.V1,
      networkId,
    )
    Bloc[Wallet](walletCreation.create(snapshot)).map { bloc =>
      new WalletStateServiceFactory[
        Wallet,
        CoinPublicKey,
        EncPublicKey,
        EncryptionSecretKey,
        TokenType,
        QualifiedCoinInfo,
        CoinInfo,
        Nullifier,
        Transaction,
      ].create(
        new WalletQueryStateService.Live(
          new WalletStateContainer.Live(bloc),
        ),
      )
    }
  }

  given WalletTxHistory[Wallet, Transaction] = wallets.walletDiscardTxHistory
  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  test("Start with balance zero") {
    buildWalletStateService().use(
      _.state
        .map(_.balances.getOrElse(nativeToken(), BigInt(0)))
        .head
        .compile
        .last
        .map(assertEquals(_, Some(BigInt(0)))),
    )
  }

  test("Sum transaction outputs to this wallet") {
    forAllF(Generators.txWithContextArbitrary.arbitrary) { txWithContextIO =>
      for {
        txWithContext <- txWithContextIO
        initialState =
          txWithContext.transaction.guaranteedCoins.fold(txWithContext.state)(
            txWithContext.state.apply,
          )
        expected =
          txWithContext.transaction.guaranteedCoins.flatMap(
            _.deltas
              .get(nativeToken())
              .map(value => -value),
          )
        result <- buildWalletStateService(initialState = initialState).use(
          _.state.head.compile.lastOrError
            .map(_.balances.get(nativeToken()))
            .map(assertEquals(_, expected.toOption.map(_.toScalaBigInt))),
        )
      } yield result
    }
  }

  test("Not sum transaction outputs to another wallet") {
    forAllF(Generators.ledgerTransactionArbitrary.arbitrary) { txWithCtxIO =>
      txWithCtxIO.flatMap { tx =>
        val anotherState = tx.guaranteedCoins.fold(LocalState())(LocalState.apply().apply)
        buildWalletStateService(initialState = anotherState).use(
          _.state.head.compile.lastOrError
            .map(_.balances.get(nativeToken()))
            .map(assertEquals(_, None)),
        )
      }
    }
  }

  test("Return the public and viewing keys") {
    val initialState = LocalState()
    val expected =
      (
        initialState.coinPublicKey,
        initialState.encryptionPublicKey,
        initialState.yesIKnowTheSecurityImplicationsOfThis_encryptionSecretKey().serialize,
      )
    buildWalletStateService(initialState).use(
      _.keys.map((cpk, epk, vk) => (cpk, epk, vk.serialize)).assertEquals(expected),
    )
  }

  test("Calculate cost as the sum of tx imbalances") {
    forAllF(Generators.ledgerTransactionArbitrary.arbitrary) { txIO =>
      txIO.map { tx =>
        assertEquals(
          WalletStateService.calculateCost(tx).toJsBigInt,
          tx.imbalances(true, tx.fees(LedgerParameters.dummyParameters()))
            .toMap
            .getOrElse(nativeToken(), js.BigInt(0)),
        )
      }
    }
  }
}
