package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.wallet.core.BalanceTransactionService.NotSufficientFunds
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite, TestOptions}

import scala.annotation.tailrec
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce

@SuppressWarnings(Array("org.wartremover.warts.Equals"))
class BalanceTransactionServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  private def buildBalanceTxService(): BalanceTransactionService[IO] =
    new BalanceTransactionService.Live[IO]()

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
    val imbalancedTx = Generators.generateLedgerTransaction().transaction
    val imbalance = sumImbalance(imbalancedTx.imbalances())
    // generating reasonable amount of coins
    val coins = Generators.generateCoinsFor(imbalance * imbalance)
    val stateWithCoins = Generators.generateStateWithCoins(coins)
    (stateWithCoins, imbalancedTx, coins)
  }

  test("balance transaction and output change") {
    val (stateWithCoins, imbalancedTx, coins) = generateData()
    buildBalanceTxService()
      .balanceTransaction(stateWithCoins, imbalancedTx)
      .map { case (balancedTx, newState) =>
        balancedTx.wellFormed(true)
        // checking existence of the change
        newState.applyLocal(balancedTx)
        assert(diff(newState.coins, coins).length === 1)
      }
  }

  test(TestOptions("balance transaction without change").ignore) {}

  test(TestOptions("no transaction and state changes when there is nothing to balance").ignore) {}

  test("no transaction changes when tx has positive imbalance") {
    val (stateWithCoins, imbalancedTx, _) = generateData()
    val balanceTxService = buildBalanceTxService()

    balanceTxService
      .balanceTransaction(stateWithCoins, imbalancedTx)
      .flatMap { case (balancedTx, _) =>
        balanceTxService.balanceTransaction(stateWithCoins, balancedTx).map {
          case (doubleBalancedTx, _) =>
            (balancedTx, doubleBalancedTx)
        }
      }
      .map { case (balancedTx, doubleBalancedTx) =>
        assertEquals(balancedTx, doubleBalancedTx)
      }
  }

  test("fails when not enough funds to balance transaction cost") {
    val imbalancedTx = Generators.generateLedgerTransaction().transaction
    val imbalance = sumImbalance(imbalancedTx.imbalances())
    // generating not enough coins
    val stateWithCoins = Generators.generateStateWithFunds(imbalance)

    buildBalanceTxService()
      .balanceTransaction(stateWithCoins, imbalancedTx)
      .attempt
      .map(assertEquals(_, Left(NotSufficientFunds)))
  }
}
