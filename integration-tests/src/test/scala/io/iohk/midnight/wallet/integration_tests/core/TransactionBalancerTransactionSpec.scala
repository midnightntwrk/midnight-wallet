package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.core.{Generators, TransactionBalancer}
import io.iohk.midnight.wallet.core.Generators.{TransactionWithContext, txWithContextArbitrary}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.js.interop.util.SetOps.*
import io.iohk.midnight.wallet.zswap.given
import munit.TestOptions
import org.scalacheck.Arbitrary
import org.scalacheck.effect.PropF.forAllF

@SuppressWarnings(Array("org.wartremover.warts.Equals"))
class TransactionBalancerTransactionSpec extends WithProvingServerSuite {

  private val costModel = TransactionCostModel.dummyTransactionCostModel()
  private val inputFeeOverhead = costModel.inputFeeOverhead
  private val outputFeeOverhead = costModel.outputFeeOverhead

  private val transactionBalancer =
    new TransactionBalancer[
      TokenType,
      UnprovenTransaction,
      UnprovenOffer,
      UnprovenInput,
      UnprovenOutput,
      LocalStateNoKeys,
      SecretKeys,
      Transaction,
      Offer,
      QualifiedCoinInfo,
      CoinPublicKey,
      EncPublicKey,
      CoinInfo,
    ]

  override def munitFlakyOK = true

  given transactionDataArbitrary(using
      txWithContextArbitrary: Arbitrary[IO[TransactionWithContext]],
  ): Arbitrary[IO[(LocalStateNoKeys, SecretKeys, Transaction, NonEmptyList[CoinInfo])]] = {
    Arbitrary {
      txWithContextArbitrary.arbitrary.map { txWithContextIO =>
        txWithContextIO.map { txWithContext =>
          // generating reasonable amount of native coins for fees
          val nativeTokenAmount =
            (nativeToken(), (inputFeeOverhead * outputFeeOverhead).toScalaBigInt)
          // generating reasonable amount of coins
          val imbalances = nativeTokenAmount :: txWithContext.coins.map(coin =>
            (coin.`type`, (coin.value * coin.value).toScalaBigInt),
          )
          val coins = Generators.generateCoinsFor(imbalances)
          val (stateWithCoins, secretKeys) = Generators.generateStateWithCoins(coins)
          (stateWithCoins, secretKeys, txWithContext.transaction, coins)
        }
      }
    }
  }

  test("balance transaction and output change") {
    forAllF { (data: IO[(LocalStateNoKeys, SecretKeys, Transaction, NonEmptyList[CoinInfo])]) =>
      data.map { case (stateWithCoins, secretKeys, imbalancedTx, _) =>
        transactionBalancer
          .balanceTransaction(stateWithCoins, secretKeys, imbalancedTx) match {
          case Left(error) => fail(error.getMessage, error)
          case Right(
                transactionBalancer.BalanceTransactionResult
                  .BalancedTransactionAndState(balancedTx, newState),
              ) =>
            val balancedTransaction = imbalancedTx.eraseProofs().merge(balancedTx.eraseProofs())
            assert(
              balancedTransaction
                .imbalances(true, balancedTransaction.fees(LedgerParameters.dummyParameters()))
                .toList
                .forall(_._2.toScalaBigInt >= BigInt(0)),
            )
            assert(
              balancedTransaction.imbalances(false).toList.forall(_._2.toScalaBigInt >= BigInt(0)),
            )
            assert(newState.pendingOutputs.size > 0)
          case Right(_) => fail("No-op path: transaction was already balanced")
        }
      }
    }
  }

  // Proving transactions with inputs takes significant time - test often fails
  test(new TestOptions("no transaction changes when tx has positive imbalances").flaky) {
    forAllF { (data: IO[(LocalStateNoKeys, SecretKeys, Transaction, NonEmptyList[CoinInfo])]) =>
      data.flatMap { case (stateWithCoins, secretKeys, imbalancedTx, _) =>
        transactionBalancer
          .balanceTransaction(stateWithCoins, secretKeys, imbalancedTx) match
          case Right(
                transactionBalancer.BalanceTransactionResult
                  .BalancedTransactionAndState(unprovenBalancedTx, _),
              ) =>
            provingService.proveTransaction(unprovenBalancedTx).map { balancedTx =>
              transactionBalancer.balanceTransaction(stateWithCoins, secretKeys, balancedTx) match
                case Right(
                      transactionBalancer.BalanceTransactionResult
                        .ReadyTransactionAndState(doubleBalancedOffer, _),
                    ) =>
                  assertEquals(balancedTx, doubleBalancedOffer)
                case Left(error) => fail("Transaction must be balanced properly", error.getCause)
                case Right(_)    => fail("Transaction shouldn't be balanced again")
            }
          case _ => IO(fail("First transaction must be balanced properly"))
      }
    }
  }

  test("fails when not enough funds to balance transaction cost") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.map { txWithContext =>
        val imbalances = txWithContext.coins.map(coin => (coin.`type`, coin.value.toScalaBigInt))
        val possibleTokenTypes = txWithContext.coins.map(_.`type`).prepend(nativeToken())
        // generating not enough coins
        val (stateWithCoins, secretKeys) = Generators.generateStateWithFunds(imbalances)

        transactionBalancer
          .balanceTransaction(stateWithCoins, secretKeys, txWithContext.transaction) match {
          case Left(transactionBalancer.NotSufficientFunds(tokenType)) =>
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
        val stateWithSpentCoins = stateCoins.toList.foldLeft(stateWithCoins) { (accState, coin) =>
          accState.spend(txWithContext.secretKeys, coin)._1
        }
        val possibleTokenTypes = txWithContext.coins.map(_.`type`).prepend(nativeToken())

        transactionBalancer
          .balanceTransaction(
            stateWithSpentCoins,
            txWithContext.secretKeys,
            txWithContext.transaction,
          ) match {
          case Left(transactionBalancer.NotSufficientFunds(tokenType)) =>
            assert(possibleTokenTypes.exists(_ === tokenType))
          case _ =>
            fail("Balancing transaction process should fail because of not sufficient funds")
        }
      }
    }
  }
}
