package io.iohk.midnight.wallet.core

import cats.effect.{IO, Resource}
import cats.syntax.foldable.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.wallet.core.Generators.{TransactionWithContext, ledgerTransactionGen}
import io.iohk.midnight.wallet.core.services.SyncServiceStub
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.Prop.forAll
import org.scalacheck.effect.PropF.forAllF

import scala.concurrent.duration.DurationInt
import scala.scalajs.js

class WalletStateSpec extends CatsEffectSuite with ScalaCheckEffectSuite with BetterOutputSuite {
  def buildWallet(
      initialState: ZSwapLocalState = new ZSwapLocalState(),
  ): Resource[IO, WalletState[IO]] =
    WalletState.Live[IO](new SyncServiceStub(), initialState)

  test("Start with balance zero") {
    buildWallet().use(
      _.balance.head.compile.last
        .map(assertEquals(_, Some(js.BigInt(0)))),
    )
  }

  test("Sum transaction outputs to this wallet") {
    val coinsGen = Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, Generators.coinInfoGen))
    forAllF(coinsGen) { coins =>
      val (tx, state) = Generators.buildTransaction(coins)
      state.applyLocal(tx)
      val expected = coins.map(_.value).combineAll(sum)

      buildWallet(initialState = state).use(
        _.balance.head.compile.last
          .map(assertEquals(_, Some(expected))),
      )
    }
  }

  test("Not sum transaction outputs to another wallet") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val anotherState = new ZSwapLocalState()
      anotherState.applyLocal(txWithCtx.transaction)
      buildWallet(initialState = anotherState).use(
        _.balance.head.compile.last
          .map(assertEquals(_, Some(js.BigInt(0)))),
      )
    }
  }

  test("Return the public key") {
    val initialState = new ZSwapLocalState()
    val expected = LedgerSerialization.serializePublicKey(initialState.coinPublicKey)
    buildWallet(initialState = initialState).use(
      _.publicKey
        .map(LedgerSerialization.serializePublicKey)
        .map(assertEquals(_, expected)),
    )
  }

  test("Calculate cost as the sum of tx imbalances") {
    forAll(ledgerTransactionGen) { txWithCtx =>
      val tx = txWithCtx.transaction
      assertEquals(WalletState.calculateCost(tx), tx.imbalances().map(_.imbalance).combineAll(sum))
    }
  }

  test("Return the state") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, state, _) = txWithCtx

      state.applyLocal(tx)
      buildWallet(initialState = state)
        .use(_.localState.assertEquals(state))
    }
  }

  test("Update the state") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, state, _) = txWithCtx

      state.applyLocal(tx)
      buildWallet().use { wallet =>
        wallet
          .updateLocalState(state)
          .start
          .flatTap(_ => IO.sleep(1.nano))
          .flatMap(_ => wallet.localState)
          .assertEquals(state)
      }
    }
  }
}
