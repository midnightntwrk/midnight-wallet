package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.wallet.core.Generators.ledgerTransactionGen
import io.iohk.midnight.wallet.core.services.BalanceTransactionService.NotSufficientResources
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.core.{Generators, WalletState}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite, TestOptions}
import typings.midnightLedger.mod.*

import scala.annotation.tailrec
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial", "org.wartremover.warts.Equals"))
class BalanceTransactionServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  private def buildBalanceTxService(
      initialState: ZSwapLocalState,
  ): IO[BalanceTransactionService[IO]] = {
    WalletState
      .Live(new SyncServiceStub(), initialState)
      .map(new BalanceTransactionService.Live[IO](_))
  }

  private def diff(array: js.Array[CoinInfo], arrayToRemove: List[CoinInfo]): js.Array[CoinInfo] = {
    @tailrec
    def removeElement(
        elementsToCheck: List[CoinInfo],
        element: CoinInfo,
        checkedElements: List[CoinInfo],
    ): List[CoinInfo] = {
      elementsToCheck match {
        case head :: tail if head.value == element.value => checkedElements.reverse ::: tail
        case head :: tail => removeElement(tail, element, head :: checkedElements)
        case Nil          => checkedElements.reverse
      }
    }

    arrayToRemove.foldLeft(array.toList)((acc, el) => removeElement(acc, el, List.empty)).toJSArray
  }

  private def sumImbalance(imbalances: js.Array[TxImbalance]): js.BigInt =
    imbalances.map(_.imbalance).combineAll(sum)

  private def generateData(): (ZSwapLocalState, Transaction, List[CoinInfo]) = {
    val imbalancedTx = ledgerTransactionGen.sample.get._1
    val imbalance = sumImbalance(imbalancedTx.imbalances())
    // generating reasonable amount of coins
    val coins = Generators.generateCoinsFor(imbalance * imbalance)
    val (mintTx, state) = Generators.buildTransaction(coins)
    val stateWithCoins = state.applyLocal(mintTx)
    (stateWithCoins, imbalancedTx, coins)
  }

  test("balance transaction and output change") {
    val (stateWithCoins, imbalancedTx, coins) = generateData()

    buildBalanceTxService(stateWithCoins)
      .flatMap(_.balanceTransaction(imbalancedTx))
      .map { case (balancedTx, newState) =>
        assert(balancedTx.wellFormed(true))
        // checking existence of the change
        assert(diff(newState.applyLocal(balancedTx).coins, coins).length === 1)
      }
  }

  test(TestOptions("balance transaction without change").ignore) {}

  test(TestOptions("no transaction and state changes when there is nothing to balance").ignore) {}

  test("no transaction changes when tx has positive imbalance") {
    val (stateWithCoins, imbalancedTx, _) = generateData()

    buildBalanceTxService(stateWithCoins)
      .flatMap(wallet =>
        wallet.balanceTransaction(imbalancedTx).map { case (balancedTx, _) =>
          (wallet, balancedTx)
        },
      )
      .flatMap { case (wallet, balancedTx) =>
        wallet.balanceTransaction(balancedTx).map { case (doubleBalancedTx, _) =>
          (balancedTx, doubleBalancedTx)
        }
      }
      .map { case (balancedTx, doubleBalancedTx) =>
        assertEquals(balancedTx, doubleBalancedTx)
      }
  }

  test("fails when not enough resources to balance transaction cost") {
    val imbalancedTx = ledgerTransactionGen.sample.get._1
    val imbalance = sumImbalance(imbalancedTx.imbalances())
    // generating not enough coins
    val coins = Generators.generateCoinsFor(imbalance)
    val (mintTx, state) = Generators.buildTransaction(coins)
    val stateWithCoins = state.applyLocal(mintTx)

    buildBalanceTxService(stateWithCoins)
      .flatMap(_.balanceTransaction(imbalancedTx))
      .attempt
      .map(assertEquals(_, Left(NotSufficientResources)))
  }

  test("fails when cannot get a state") {
    val error = new Throwable("Wallet State Error")
    val walletState = new WalletState[IO] {
      override def start(): IO[Unit] = ???
      override def publicKey(): IO[ZSwapCoinPublicKey] = ???
      override def balance(): fs2.Stream[IO, js.BigInt] = ???
      override def localState(): IO[ZSwapLocalState] = IO.raiseError(error)
      override def updateLocalState(newState: ZSwapLocalState): IO[Unit] = ???
    }

    val balanceTransactionService = new BalanceTransactionService.Live[IO](walletState)
    val imbalancedTx = ledgerTransactionGen.sample.get._1

    balanceTransactionService
      .balanceTransaction(imbalancedTx)
      .attempt
      .map(assertEquals(_, Left(error)))
  }
}
