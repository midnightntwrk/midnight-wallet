package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.syntax.foldable.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.wallet.core.services.SyncServiceStub
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import scala.scalajs.js
import typings.midnightLedger.mod.ZSwapLocalState

class WalletStateSpec extends CatsEffectSuite with ScalaCheckEffectSuite with BetterOutputSuite {
  def buildWallet(initialState: ZSwapLocalState = new ZSwapLocalState()): IO[WalletState[IO]] =
    WalletState.Live[IO](new SyncServiceStub(), initialState)

  test("Start with balance zero") {
    buildWallet()
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(js.BigInt(0))))
  }

  test("Sum transaction outputs to this wallet") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val coins = Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, Generators.coinInfoGen)).sample.get
    val (tx, state) = Generators.buildTransaction(coins)
    val expected = coins.map(_.value).combineAll(sum)
    buildWallet(initialState = state.applyLocal(tx))
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(expected)))
  }

  test("Not sum transaction outputs to another wallet") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val anotherState = new ZSwapLocalState()
    buildWallet(initialState = anotherState.applyLocal(tx))
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(js.BigInt(0))))
  }

  test("Return the public key") {
    val initialState = new ZSwapLocalState()
    val expected = LedgerSerialization.serializePublicKey(initialState.coinPublicKey)
    buildWallet(initialState = initialState)
      .flatMap(_.publicKey())
      .map(LedgerSerialization.serializePublicKey)
      .map(assertEquals(_, expected))
  }

  test("Calculate cost as the sum of tx imbalances") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    assertEquals(WalletState.calculateCost(tx), tx.imbalances().map(_.imbalance).combineAll(sum))
  }
}
