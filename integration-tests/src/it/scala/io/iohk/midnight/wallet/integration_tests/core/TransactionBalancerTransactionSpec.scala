package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.core.{Generators, TransactionBalancer}
import io.iohk.midnight.wallet.core.Generators.{TransactionWithContext, txWithContextArbitrary}
import io.iohk.midnight.wallet.core.TransactionBalancer.{
  BalanceTransactionResult,
  NotSufficientFunds,
  balanceTransaction,
}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*
import munit.TestOptions
import org.scalacheck.Arbitrary
import org.scalacheck.effect.PropF.forAllF

@SuppressWarnings(Array("org.wartremover.warts.Equals"))
class TransactionBalancerTransactionSpec extends WithProvingServerSuite {

  override def munitFlakyOK = true

  given transactionDataArbitrary(using
      txWithContextArbitrary: Arbitrary[IO[TransactionWithContext]],
  ): Arbitrary[IO[(LocalState, Transaction, NonEmptyList[CoinInfo])]] = {
    Arbitrary {
      txWithContextArbitrary.arbitrary.map { txWithContextIO =>
        txWithContextIO.map { txWithContext =>
          // generating reasonable amount of native coins for fees
          val nativeTokenAmount =
            (TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead)
          // generating reasonable amount of coins
          val imbalances = nativeTokenAmount :: txWithContext.coins.map(coin =>
            (coin.tokenType, coin.value * coin.value),
          )
          val coins = Generators.generateCoinsFor(imbalances)
          val stateWithCoins = Generators.generateStateWithCoins(coins)
          (stateWithCoins, txWithContext.transaction, coins)
        }
      }
    }
  }

  test("balance transaction and output change") {
    forAllF { (data: IO[(LocalState, Transaction, NonEmptyList[CoinInfo])]) =>
      data.map { case (stateWithCoins, imbalancedTx, coins) =>
        TransactionBalancer
          .balanceTransaction(stateWithCoins, imbalancedTx) match {
          case Left(error) => fail(error.getMessage, error)
          case Right(BalanceTransactionResult.BalancedTransactionAndState(balancedTx, newState)) =>
            val balancedTransaction = imbalancedTx.eraseProofs.merge(balancedTx.eraseProofs)
            assert(
              balancedTransaction
                .imbalances(true, balancedTransaction.fees)
                .forall(_._2 >= BigInt(0)),
            )
            assert(balancedTransaction.imbalances(false).forall(_._2 >= BigInt(0)))
            assert(newState.pendingSpends.sizeIs > 0)
            assert(newState.pendingOutputsSize > 0)
          case Right(_) => fail("No-op path: transaction was already balanced")
        }
      }
    }
  }

  // Proving transactions with inputs takes significant time - test often fails
  test(new TestOptions("no transaction changes when tx has positive imbalances").flaky) {
    forAllF { (data: IO[(LocalState, Transaction, NonEmptyList[CoinInfo])]) =>
      data.flatMap { case (stateWithCoins, imbalancedTx, _) =>
        TransactionBalancer
          .balanceTransaction(stateWithCoins, imbalancedTx) match
          case Right(BalanceTransactionResult.BalancedTransactionAndState(unprovenBalancedTx, _)) =>
            provingService.proveTransaction(unprovenBalancedTx).map { balancedTx =>
              TransactionBalancer.balanceTransaction(stateWithCoins, balancedTx) match
                case Right(
                      BalanceTransactionResult
                        .ReadyTransactionAndState(doubleBalancedOffer, newState),
                    ) =>
                  assertEquals(balancedTx, doubleBalancedOffer)
                case Left(error)  => fail("Transaction must be balanced properly", error.getCause)
                case Right(value) => fail("Transaction shouldn't be balanced again")
            }
          case _ => IO(fail("First transaction must be balanced properly"))
      }
    }
  }

  test("fails when not enough funds to balance transaction cost") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.map { txWithContext =>
        val imbalances = txWithContext.coins.map(coin => (coin.tokenType, coin.value))
        val possibleTokenTypes = txWithContext.coins.map(_.tokenType).prepend(TokenType.Native)
        // generating not enough coins
        val stateWithCoins = Generators.generateStateWithFunds(imbalances)

        TransactionBalancer
          .balanceTransaction(stateWithCoins, txWithContext.transaction) match {
          case Left(NotSufficientFunds(tokenType)) =>
            assert(possibleTokenTypes.exists(_ === tokenType))
          case _ =>
            fail("Balancing transaction process should fail because of not sufficient funds")
        }
      }
    }
  }

  test("fails when not enough funds to balance transaction cost (all coins are pending spends)") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.map { txWithContext =>
        val stateWithCoins = txWithContext.state
        val stateCoins = stateWithCoins.coins
        val stateWithSpentCoins = stateCoins.foldLeft(stateWithCoins) { (accState, coin) =>
          accState.spend(coin)._1
        }
        val possibleTokenTypes = txWithContext.coins.map(_.tokenType).prepend(TokenType.Native)

        TransactionBalancer
          .balanceTransaction(stateWithSpentCoins, txWithContext.transaction) match {
          case Left(NotSufficientFunds(tokenType)) =>
            assert(possibleTokenTypes.exists(_ === tokenType))
          case _ =>
            fail("Balancing transaction process should fail because of not sufficient funds")
        }
      }
    }
  }
}
