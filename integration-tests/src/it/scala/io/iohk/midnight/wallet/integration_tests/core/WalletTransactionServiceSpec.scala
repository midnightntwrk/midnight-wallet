package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.wallet.core
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.capabilities.{WalletCreation, WalletTxBalancing}
import io.iohk.midnight.wallet.core.domain.{Address, TokenTransfer}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*
import org.scalacheck.effect.PropF.forAllF

class WalletTransactionServiceSpec extends WithProvingServerSuite {

  def buildWalletTransactionService[TWallet](
      initialState: LocalState = LocalState(),
  )(using
      walletCreation: WalletCreation[TWallet, Wallet.Snapshot],
      walletTxBalancing: WalletTxBalancing[TWallet, Transaction, CoinInfo],
  ): Resource[IO, WalletTransactionService[IO]] = {
    val snapshot = Wallet.Snapshot(initialState, Seq.empty, None)
    Bloc[IO, TWallet](walletCreation.create(snapshot)).map { bloc =>
      new core.WalletTransactionService.Live[IO, TWallet](
        new WalletStateContainer.Live(bloc),
        provingService,
      )
    }
  }

  import Wallet.*

  test("Prove given unproven transaction") {
    forAllF { (unprovenTx: UnprovenTransaction) =>
      buildWalletTransactionService().use { walletTransactionService =>
        walletTransactionService
          .proveTransaction(domain.TransactionToProve(unprovenTx))
          .map { provenTx =>
            assertEquals(
              provenTx.guaranteedCoins.deltas.toMap,
              unprovenTx.guaranteedCoins.deltas.toMap,
            )
          }
      }
    }
  }

  test("Prove given unproven transaction and merge it with given transaction") {
    forAllF { (txIO: IO[Transaction], unprovenTx: UnprovenTransaction) =>
      buildWalletTransactionService().use { walletTransactionService =>
        for {
          tx <- txIO
          result <- walletTransactionService.proveTransaction(
            domain.BalanceTransactionToProve(unprovenTx, tx),
          )
        } yield assertEquals(
          result.guaranteedCoins.outputsSize,
          tx.guaranteedCoins.outputsSize + unprovenTx.guaranteedCoins.outputs.length,
        )
      }
    }
  }

  test("Return the same transaction when nothing to prove") {
    forAllF { (txIO: IO[Transaction]) =>
      buildWalletTransactionService().use { walletTransactionService =>
        for {
          tx <- txIO
          result <- walletTransactionService.proveTransaction(domain.NothingToProve(tx))
        } yield assertEquals(result, tx)
      }
    }
  }

  test("Prepare recipe for balanced transfer transaction") {
    forAllF { (transfers: NonEmptyList[TokenTransfer]) =>
      val initialState = Generators.generateStateWithFunds(
        transfers
          .map(tt => (tt.tokenType, tt.amount * tt.amount + tt.amount))
          .prepend(TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead),
      )
      buildWalletTransactionService(initialState).use { walletTransactionService =>
        walletTransactionService.prepareTransferRecipe(transfers.toList).map {
          case domain.TransactionToProve(toProve) =>
            assert(toProve.guaranteedCoins.outputs.length >= transfers.size)
            assert(toProve.guaranteedCoins.inputs.nonEmpty)
            assert(toProve.guaranteedCoins.deltas.toList.forall(_._2 >= BigInt(0)))
        }
      }
    }
  }

  test("Prepare recipe for balanced transfer transaction and filter out negative transfers") {
    forAllF { (transfers: NonEmptyList[TokenTransfer]) =>
      val invalidTransfer = TokenTransfer(BigInt(-1), TokenType("invalid"), Address("invalid"))
      val initialState = Generators.generateStateWithFunds(
        transfers
          .map(tt => (tt.tokenType, tt.amount * tt.amount + tt.amount))
          .prepend(TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead),
      )
      buildWalletTransactionService(initialState).use { walletTransactionService =>
        walletTransactionService.prepareTransferRecipe(invalidTransfer :: transfers.toList).map {
          case domain.TransactionToProve(toProve) =>
            assert(toProve.guaranteedCoins.outputs.sizeIs >= transfers.size)
            assert(toProve.guaranteedCoins.inputs.nonEmpty)
            assert(toProve.guaranteedCoins.deltas.toList.forall(_._2 >= BigInt(0)))
            assert(
              toProve.guaranteedCoins.deltas.get(invalidTransfer.tokenType).isEmpty,
            )
        }
      }
    }
  }

  test("Fails when no token transfers given") {
    buildWalletTransactionService().use { walletTransactionService =>
      interceptMessageIO[Throwable](
        "List of token transfers is empty or there is no positive transfers",
      )(walletTransactionService.prepareTransferRecipe(List.empty))
    }
  }

  test("Fails when not enough funds for transfer transaction") {
    forAllF { (transfers: NonEmptyList[TokenTransfer]) =>
      buildWalletTransactionService().use { walletTransactionService =>
        walletTransactionService.prepareTransferRecipe(transfers.toList).attempt.map {
          case Left(error) =>
            assert(error.getMessage.startsWith("Not sufficient funds to balance token:"))
          case Right(value) => fail("prepareTransferRecipe without funds must fail")
        }
      }
    }
  }

  test("Prepare recipe for balancing given transaction") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.flatMap { case TransactionWithContext(transaction, _, coins) =>
        val initialState = Generators.generateStateWithFunds(
          coins
            .map(coin => (coin.tokenType, coin.value * coin.value + coin.value))
            .prepend(TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead),
        )

        buildWalletTransactionService(initialState).use { walletTransactionService =>
          walletTransactionService.balanceTransaction(transaction, coins.toList).map {
            case domain.BalanceTransactionToProve(toProve, toBalance) =>
              assertEquals(toBalance, transaction)
              val balancedTransaction = transaction.eraseProofs.merge(toProve.eraseProofs)
              assert(
                balancedTransaction
                  .imbalances(true, balancedTransaction.fees)
                  .forall(_._2 >= BigInt(0)),
              )
              assert(balancedTransaction.imbalances(false).forall(_._2 >= BigInt(0)))
            case domain.NothingToProve(transaction) =>
              fail("balanceTransaction must produce transaction to prove")
          }
        }
      }
    }
  }

  test("Fails when not enough funds for balancing given transaction") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.flatMap { case TransactionWithContext(transaction, state, coins) =>
        buildWalletTransactionService().use { walletTransactionService =>
          walletTransactionService.balanceTransaction(transaction, coins.toList).attempt.map {
            case Left(error) =>
              assert(error.getMessage.startsWith("Not sufficient funds to balance token:"))
            case Right(value) => fail("balanceTransaction without funds must fail")
          }
        }
      }
    }
  }
}
