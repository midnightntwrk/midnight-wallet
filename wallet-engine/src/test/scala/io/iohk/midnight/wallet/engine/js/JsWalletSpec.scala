package io.iohk.midnight.wallet.engine.js

import cats.effect.{Deferred, IO, Ref}
import cats.syntax.all.*
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.rxjs.mod.firstValueFrom
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.combinator.{
  CombinationMigrations,
  VersionCombination,
  VersionCombinator,
}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.{core, zswap}
import io.iohk.midnight.wallet.zswap.{Transaction, given}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF

import scala.concurrent.duration.DurationInt

class JsWalletSpec extends CatsEffectSuite with ScalaCheckEffectSuite with BetterOutputSuite {

  type Wallet = core.Wallet[LocalStateNoKeys, SecretKeys, Transaction]

  private given core.SnapshotInstances[LocalStateNoKeys, Transaction] = new core.SnapshotInstances

  private val walletInstances: core.WalletInstances[
    LocalStateNoKeys,
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
  ] = new WalletInstances

  given WalletTxHistory[Wallet, Transaction] = walletInstances.walletDiscardTxHistory
  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  test("balance should return wallet balance") {
    val coinPubKey = "064e092a80b33bee23404c46cfc48fec75a2356a9b01178dd6a62c29f5896f67"
    val encPubKey = "test-encPubKey"

    forAllF(Gen.posNum[BigInt]) { (balance: BigInt) =>
      val walletResource = for {
        combination <- VersionCombinationStub(coinPubKey, encPubKey, balance).toResource
        deferred <- Deferred[IO, Unit].toResource
        bloc <- Bloc[VersionCombination](combination)
        combinator = new VersionCombinator(bloc, CombinationMigrations.default, networkId, deferred)
      } yield new JsWallet(combinator, IO.unit, Deferred.unsafe[IO, Unit])

      walletResource.use { wallet =>
        val observable = wallet.state()
        IO.fromPromise(IO(firstValueFrom(observable)))
          .map(_.balances)
          .map(r => assertEquals(r.get(nativeToken()), Some(balance.toJsBigInt)))
      }
    }
  }

  test("publicKey should return wallet coin public key") {
    val coinPubKey = "064e092a80b33bee23404c46cfc48fec75a2356a9b01178dd6a62c29f5896f67"
    val encPubKey = "test-encPubKey"
    val walletResource = for {
      combination <- VersionCombinationStub(coinPubKey, encPubKey, BigInt(1)).toResource
      deferred <- Deferred[IO, Unit].toResource
      bloc <- Bloc[VersionCombination](combination)
      combinator = new VersionCombinator(bloc, CombinationMigrations.default, networkId, deferred)
    } yield new JsWallet(combinator, IO.unit, Deferred.unsafe[IO, Unit])

    walletResource.use { wallet =>
      IO.fromPromise(IO(firstValueFrom(wallet.state())))
        .map(state => (state.coinPublicKey, state.encryptionPublicKey))
        .assertEquals(
          (
            "mn_shield-cpk_undeployed1qe8qj25qkva7ug6qf3rvl3y0a366ydt2nvq30rwk5ckznavfdanslfec58",
            "mn_shield-epk_undeployed1jsq66e",
          ),
        )
    }
  }

  test("should close") {
    val walletResource = for {
      ref <- Ref.of[IO, Boolean](false).toResource
      deferred <- Deferred[IO, Unit].toResource
      combination <- VersionCombinationStub().toResource
      bloc <- Bloc[VersionCombination](combination)
      combinator = new VersionCombinator(bloc, CombinationMigrations.default, networkId, deferred)
    } yield (ref, new JsWallet(combinator, ref.set(true), deferred))

    walletResource.use { (ref, wallet) =>
      IO.fromPromise(IO(wallet.close())) >> ref.get.assert
    }
  }

  test("wallet should start") {
    val walletResource = for {
      isStarted <- Deferred[IO, Boolean].toResource
      deferred <- Deferred[IO, Unit].toResource
      combination = new VersionCombinationStub("", "", BigInt(1), isStarted)
      bloc <- Bloc[VersionCombination](combination)
      combinator = new VersionCombinator(bloc, CombinationMigrations.default, networkId, deferred)
    } yield (isStarted, new JsWallet(combinator, IO.unit, deferred))

    walletResource.use { (isStarted, wallet) =>
      IO(wallet.start()) >> isStarted.get.timeout(5.seconds).assert
    }
  }

  test("Serialize wallet state") {
    val generated = JsWallet.generateInitialState(networkId.toJs)
    IO.fromPromise(
      IO(
        JsWallet.restore(
          "http://indexer",
          "http://indexer",
          "http://prover",
          "http://node",
          "0000000000000000000000000000000000000000000000000000000000000001",
          generated,
          "warn",
          discardTxHistory = false,
        ),
      ),
    ).flatMap(restored => IO.fromPromise(IO(restored.serializeState())))
      .assertEquals(generated)
  }
}
