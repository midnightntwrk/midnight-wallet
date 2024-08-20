package io.iohk.midnight.wallet.engine.js

import cats.effect.{Deferred, IO, Ref}
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.rxjs.mod.firstValueFrom
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.combinator.{CombinationMigrations, VersionCombinator}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.engine.combinator.V1Combination
import io.iohk.midnight.wallet.zswap.{CoinPublicKey, NetworkId, TokenType, Transaction}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.DurationInt

class JsWalletSpec extends CatsEffectSuite with ScalaCheckEffectSuite with BetterOutputSuite {

  given WalletTxHistory[Wallet, Transaction] = Wallet.walletDiscardTxHistory
  given networkId: NetworkId = NetworkId.Undeployed

  test("balance should return wallet balance") {
    forAllF(Gen.posNum[BigInt]) { (balance: BigInt) =>
      V1Combination[IO](
        Wallet.Snapshot.create,
        new WalletSyncServiceStub(),
        new WalletStateContainerStub(),
        new WalletStateServiceBalanceStub(balance),
      ).flatMap(VersionCombinator(_, CombinationMigrations.default)).use { combinator =>
        val wallet =
          new JsWallet(
            combinator,
            new WalletTxSubmissionServiceStub(),
            new WalletTransactionServiceStub(),
            IO.unit,
            Deferred.unsafe[IO, Unit],
          )
        val observable = wallet.state()
        IO.fromPromise(IO(firstValueFrom(observable)))
          .map(_.balances)
          .map(r => assertEquals(r.get(TokenType.Native), Some(balance.toJsBigInt)))
      }
    }
  }

  test("publicKey should return wallet coin public key") {
    val coinPubKey = CoinPublicKey("test-coinPubKey")
    val encPubKey = "test-encPubKey"
    V1Combination[IO](
      Wallet.Snapshot.create,
      new WalletSyncServiceStub(),
      new WalletStateContainerStub(),
      new WalletStateServicePubKeyStub(coinPubKey, encPubKey),
    ).flatMap(VersionCombinator(_, CombinationMigrations.default)).use { combinator =>
      val wallet =
        new JsWallet(
          combinator,
          new WalletTxSubmissionServiceStub(),
          new WalletTransactionServiceStub(),
          IO.unit,
          Deferred.unsafe[IO, Unit],
        )
      IO.fromPromise(IO(firstValueFrom(wallet.state())))
        .map(state => (state.coinPublicKey, state.encryptionPublicKey))
        .assertEquals((coinPubKey, encPubKey))
    }
  }

  test("should close") {
    for {
      ref <- Ref.of[IO, Boolean](false)
      deferred <- Deferred[IO, Unit]
      v1 <- V1Combination[IO](
        Wallet.Snapshot.create,
        new WalletSyncServiceStub(),
        new WalletStateContainerStub(),
        new WalletStateServiceStub(),
      ).allocated._1F
      combinator <- VersionCombinator(
        v1,
        CombinationMigrations.default[IO],
      ).allocated._1F
      wallet = new JsWallet(
        combinator,
        new WalletTxSubmissionServiceStub(),
        new WalletTransactionServiceStub(),
        ref.set(true),
        deferred,
      )
      _ <- IO.fromPromise(IO(wallet.close()))
      result <- ref.get
    } yield assert(result)
  }

  test("wallet should start") {
    for {
      isFinished <- Deferred[IO, Boolean]
      deferred <- Deferred[IO, Unit]
      v1 <- V1Combination[IO](
        Wallet.Snapshot.create,
        new WalletSyncServiceStartStub(isFinished),
        new WalletStateContainerStub(),
        new WalletStateServiceStub(),
      ).allocated._1F
      combinator <-
        VersionCombinator(
          v1,
          CombinationMigrations.default,
        ).allocated._1F
      wallet = new JsWallet(
        combinator,
        new WalletTxSubmissionServiceStub(),
        new WalletTransactionServiceStub(),
        IO.unit,
        deferred,
      )
      _ <- IO(wallet.start())
      result <- isFinished.get.timeout(5.seconds)
    } yield assert(result)
  }

  test("Serialize wallet state") {
    val generated = JsWallet.generateInitialState(networkId.toJs)
    for {
      restored <- IO.fromPromise(
        IO(
          JsWallet.restore(
            "http://indexer",
            "http://indexer",
            "http://prover",
            "http://node",
            generated,
            "warn",
            discardTxHistory = false,
          ),
        ),
      )
      serialized <- IO.fromPromise(IO(restored.serializeState()))
    } yield assertEquals(serialized, generated)
  }
}
