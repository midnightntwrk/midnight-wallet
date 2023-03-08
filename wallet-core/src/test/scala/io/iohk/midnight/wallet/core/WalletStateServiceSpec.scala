package io.iohk.midnight.wallet.core

import cats.effect.{IO, Resource}
import cats.syntax.foldable.*
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.wallet.core.Generators.ledgerTransactionGen
import io.iohk.midnight.wallet.core.capabilities.WalletCreation
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.Prop.forAll
import org.scalacheck.effect.PropF.forAllF

import scala.scalajs.js

class WalletStateServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {
  def buildWalletStateService[TWallet](
      initialState: ZSwapLocalState = new ZSwapLocalState(),
  )(implicit
      walletCreation: WalletCreation[TWallet, ZSwapLocalState],
  ): Resource[IO, WalletStateService[IO, TWallet]] = {
    Bloc[IO, TWallet](walletCreation.create(initialState)).map { bloc =>
      new WalletStateService.Live[IO, TWallet](
        new WalletQueryStateService.Live(
          new WalletStateContainer.Live(bloc),
        ),
      )
    }
  }

  import Wallet.*

  test("Start with balance zero") {
    buildWalletStateService().use(
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

      buildWalletStateService(initialState = state).use(
        _.balance.head.compile.last
          .map(assertEquals(_, Some(expected))),
      )
    }
  }

  test("Not sum transaction outputs to another wallet") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val anotherState = new ZSwapLocalState()
      anotherState.applyLocal(txWithCtx.transaction)
      buildWalletStateService(initialState = anotherState).use(
        _.balance.head.compile.last
          .map(assertEquals(_, Some(js.BigInt(0)))),
      )
    }
  }

  test("Return the public key") {
    val initialState = new ZSwapLocalState()
    val expected = LedgerSerialization.serializePublicKey(initialState.coinPublicKey)
    buildWalletStateService(initialState = initialState).use(
      _.publicKey
        .map(LedgerSerialization.serializePublicKey)
        .map(assertEquals(_, expected)),
    )
  }

  test("Calculate cost as the sum of tx imbalances") {
    forAll(ledgerTransactionGen) { txWithCtx =>
      val tx = txWithCtx.transaction
      assertEquals(
        WalletStateService.calculateCost(tx),
        tx.imbalances().map(_.imbalance).combineAll(sum),
      )
    }
  }
}
