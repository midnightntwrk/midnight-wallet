package io.iohk.midnight.wallet.core

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.wallet.zswap.{LocalState, TokenType}
import io.iohk.midnight.wallet.core.capabilities.WalletCreation
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}

class WalletStateServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {
  def buildWalletStateService[TWallet](
      initialState: LocalState = LocalState(),
  )(implicit
      walletCreation: WalletCreation[TWallet, LocalState],
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
      _.state
        .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
        .head
        .compile
        .last
        .map(assertEquals(_, Some(BigInt(0)))),
    )
  }

  // SOME TESTS TEMPORARY IGNORED

  /*  test("Sum transaction outputs to this wallet") {
    val coinsGen = Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, Generators.coinInfoGen))
    forAllF(coinsGen) { coins =>
      val (tx, state) = Generators.buildTransaction(coins)
      val initialState = state.apply(tx.guaranteedCoins)
      val expected = coins.map(_.value).combineAll(sum)

      buildWalletStateService(initialState = initialState).use(
        _.balance.head.compile.last
          .map(assertEquals(_, Some(expected))),
      )
    }
  }

  test("Not sum transaction outputs to another wallet") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val anotherState = new LocalState().apply(txWithCtx.transaction.guaranteedCoins)
      buildWalletStateService(initialState = anotherState).use(
        _.balance.head.compile.last
          .map(assertEquals(_, Some(js.BigInt(0)))),
      )
    }
  }*/

  test("Return the public and viewing keys") {
    val initialState = LocalState()
    val expected =
      (initialState.coinPublicKey, keyToString(initialState.encryptionSecretKey.serialize))
    buildWalletStateService(initialState).use(
      _.keys.map(_.map(vk => keyToString(vk.serialize))).assertEquals(expected),
    )
  }

  private def keyToString(bytes: Array[Byte]): String =
    bytes.map(String.format("%02X", _)).mkString

  /*  test("Calculate cost as the sum of tx imbalances") {
    forAll(ledgerTransactionGen) { txWithCtx =>
      val tx = txWithCtx.transaction
      assertEquals(
        WalletStateService.calculateCost(tx),
        tx.imbalances(true).toList.map(_._2).combineAll(sum),
      )
    }
  }*/
}
