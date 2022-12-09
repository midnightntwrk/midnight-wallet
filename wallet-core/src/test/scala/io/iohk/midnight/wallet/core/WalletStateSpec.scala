package io.iohk.midnight.wallet.core

import cats.effect.{IO, Resource}
import cats.syntax.foldable.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.wallet.core.services.SyncServiceStub
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import scala.concurrent.duration.DurationInt
import scala.scalajs.js
import typings.midnightLedger.mod.{Transaction, ZSwapLocalState}

class WalletStateSpec extends CatsEffectSuite with ScalaCheckEffectSuite with BetterOutputSuite {
  def buildWallet(
      initialState: ZSwapLocalState = new ZSwapLocalState(),
  ): Resource[IO, WalletState[IO]] =
    WalletState.Live[IO](new SyncServiceStub(), initialState)

  private def generateLedgerTxAndState(): (Transaction, ZSwapLocalState) = {
    // Taking just a sample because tx building is slow
    val data = Generators.generateLedgerTransaction()
    (data.transaction, data.state)
  }

  test("Start with balance zero") {
    buildWallet().use(
      _.balance.head.compile.last
        .map(assertEquals(_, Some(js.BigInt(0)))),
    )
  }

  test("Sum transaction outputs to this wallet") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val coins = Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, Generators.coinInfoGen)).sample.get
    val (tx, state) = Generators.buildTransaction(coins)
    state.applyLocal(tx)
    val expected = coins.map(_.value).combineAll(sum)

    buildWallet(initialState = state).use(
      _.balance.head.compile.last
        .map(assertEquals(_, Some(expected))),
    )
  }

  test("Not sum transaction outputs to another wallet") {
    val (tx, _) = generateLedgerTxAndState()
    val anotherState = new ZSwapLocalState()
    anotherState.applyLocal(tx)
    buildWallet(initialState = anotherState).use(
      _.balance.head.compile.last
        .map(assertEquals(_, Some(js.BigInt(0)))),
    )
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
    val (tx, _) = generateLedgerTxAndState()
    assertEquals(WalletState.calculateCost(tx), tx.imbalances().map(_.imbalance).combineAll(sum))
  }

  test("Return the state") {
    val (tx, state) = generateLedgerTxAndState()
    state.applyLocal(tx)
    buildWallet(initialState = state)
      .use(_.localState.assertEquals(state))
  }

  test("Update the state") {
    val (tx, state) = generateLedgerTxAndState()
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
