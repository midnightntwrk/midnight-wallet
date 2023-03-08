package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.wallet.core.Generators.ledgerTransactionGen
import io.iohk.midnight.wallet.core.TransactionBalancer.NotSufficientFunds
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{ScalaCheckSuite, TestOptions}
import org.scalacheck.Gen
import org.scalacheck.Prop.forAll

import scala.annotation.tailrec
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce

@SuppressWarnings(Array("org.wartremover.warts.Equals"))
class TransactionBalancerSpec extends ScalaCheckSuite with BetterOutputSuite {

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

  private def generateData: Gen[(ZSwapLocalState, Transaction, List[CoinInfo])] = {
    ledgerTransactionGen.map { txWithCtx =>
      val imbalancedTx = txWithCtx.transaction
      val imbalance = sumImbalance(imbalancedTx.imbalances())
      // generating reasonable amount of coins
      val coins = Generators.generateCoinsFor(imbalance * imbalance)
      val stateWithCoins = Generators.generateStateWithCoins(coins)
      (stateWithCoins, imbalancedTx, coins)
    }
  }

  test("balance transaction and output change") {
    forAll(generateData) { data =>
      val (stateWithCoins, imbalancedTx, coins) = data
      TransactionBalancer
        .balanceTransaction(stateWithCoins, imbalancedTx) match {
        case Left(error) => fail(error.getMessage, error)
        case Right((balancedTx, newState)) =>
          balancedTx.wellFormed(true)
          // checking existence of the change
          newState.applyLocal(balancedTx)
          assert(diff(newState.coins, coins).length === 1)
      }
    }
  }

  test(TestOptions("balance transaction without change").ignore) {}

  test(TestOptions("no transaction and state changes when there is nothing to balance").ignore) {}

  test("no transaction changes when tx has positive imbalance") {
    forAll(generateData) { data =>
      val (stateWithCoins, imbalancedTx, _) = data

      TransactionBalancer
        .balanceTransaction(stateWithCoins, imbalancedTx)
        .flatMap { case (balancedTx, _) =>
          TransactionBalancer.balanceTransaction(stateWithCoins, balancedTx).map {
            case (doubleBalancedTx, _) =>
              (balancedTx, doubleBalancedTx)
          }
        } match {
        case Left(error)                           => fail(error.getMessage, error)
        case Right((balancedTx, doubleBalancedTx)) => assertEquals(balancedTx, doubleBalancedTx)
      }
    }
  }

  test("fails when not enough funds to balance transaction cost") {
    forAll(ledgerTransactionGen) { txWithCtx =>
      val imbalancedTx = txWithCtx.transaction
      val imbalance = sumImbalance(imbalancedTx.imbalances())
      // generating not enough coins
      val stateWithCoins = Generators.generateStateWithFunds(imbalance)

      TransactionBalancer
        .balanceTransaction(stateWithCoins, imbalancedTx) match {
        case Left(error) => assertEquals(error, NotSufficientFunds)
        case Right(_) =>
          fail("Balancing transaction process should fail because of not sufficient funds")
      }
    }
  }
}
