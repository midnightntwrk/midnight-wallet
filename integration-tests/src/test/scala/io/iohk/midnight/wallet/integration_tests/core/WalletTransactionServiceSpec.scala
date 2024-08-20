package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.capabilities.{WalletCreation, WalletTxBalancing}
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.tracing.WalletTxServiceTracer
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.DurationInt

@SuppressWarnings(Array("org.wartremover.warts.SeqApply"))
class WalletTransactionServiceSpec extends WithProvingServerSuite {

  import Wallet.*

  def buildWalletTransactionService[TWallet](
      initialState: LocalState = LocalState(),
      prover: ProvingService[IO] = provingService,
  )(using
      walletCreation: WalletCreation[TWallet, Wallet.Snapshot],
      walletTxBalancing: WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, CoinInfo],
  ): Resource[IO, (WalletTransactionService[IO], WalletStateContainer[IO, TWallet])] = {
    val snapshot =
      Wallet.Snapshot(initialState, Seq.empty, None, ProtocolVersion.V1, NetworkId.Undeployed)
    Bloc[IO, TWallet](walletCreation.create(snapshot)).map { bloc =>
      given WalletTxServiceTracer[IO] = WalletTxServiceTracer.from(Tracer.noOpTracer)
      val walletStateContainer = new WalletStateContainer.Live(bloc)
      val walletTxService =
        new core.WalletTransactionService.Live[IO, TWallet](walletStateContainer, prover)
      (walletTxService, walletStateContainer)
    }
  }

  test("Prove given unproven transaction") {
    forAllF { (unprovenTx: UnprovenTransaction) =>
      buildWalletTransactionService().use { (walletTransactionService, _) =>
        walletTransactionService
          .proveTransaction(domain.TransactionToProve(unprovenTx))
          .map { provenTx =>
            assertEquals(
              provenTx.guaranteedCoins.map(_.deltas.toMap),
              unprovenTx.guaranteedCoins.map(_.deltas.toMap),
            )
          }
      }
    }
  }

  test("Prove given unproven transaction and merge it with given transaction") {
    forAllF { (txIO: IO[Transaction], unprovenTx: UnprovenTransaction) =>
      buildWalletTransactionService().use { (walletTransactionService, _) =>
        for {
          tx <- txIO
          result <- walletTransactionService.proveTransaction(
            domain.BalanceTransactionToProve(unprovenTx, tx),
          )
        } yield assertEquals(
          result.guaranteedCoins.map(_.outputsSize).getOrElse(0),
          tx.guaranteedCoins
            .map(_.outputsSize)
            .getOrElse(0) + unprovenTx.guaranteedCoins.map(_.outputs.length).getOrElse(0),
        )
      }
    }
  }

  test("Return the same transaction when nothing to prove") {
    forAllF { (txIO: IO[Transaction]) =>
      buildWalletTransactionService().use { (walletTransactionService, _) =>
        for {
          tx <- txIO
          result <- walletTransactionService.proveTransaction(domain.NothingToProve(tx))
        } yield assertEquals(result, tx)
      }
    }
  }

  test("Prepare recipe for balanced transfer transaction") {
    forAllF { (transfers: NonEmptyList[domain.TokenTransfer]) =>
      val initialState = Generators.generateStateWithFunds(
        transfers
          .map(tt => (tt.tokenType, tt.amount * tt.amount + tt.amount))
          .prepend(TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead),
      )
      buildWalletTransactionService(initialState).use { (walletTransactionService, _) =>
        walletTransactionService.prepareTransferRecipe(transfers.toList).map {
          case domain.TransactionToProve(toProve) =>
            assert(toProve.guaranteedCoins.exists(_.outputs.length >= transfers.size))
            assert(toProve.guaranteedCoins.exists(_.inputs.nonEmpty))
            assert(toProve.guaranteedCoins.exists(_.deltas.toList.forall(_._2 >= BigInt(0))))
        }
      }
    }
  }

  test("Prepare recipe for balanced transfer transaction and filter out negative transfers") {
    forAllF { (transfers: NonEmptyList[domain.TokenTransfer]) =>
      val invalidTransfer =
        domain.TokenTransfer(BigInt(-1), TokenType("invalid"), domain.Address("invalid"))
      val initialState = Generators.generateStateWithFunds(
        transfers
          .map(tt => (tt.tokenType, tt.amount * tt.amount + tt.amount))
          .prepend(TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead),
      )
      buildWalletTransactionService(initialState).use { (walletTransactionService, _) =>
        walletTransactionService.prepareTransferRecipe(invalidTransfer :: transfers.toList).map {
          case domain.TransactionToProve(toProve) =>
            assert(toProve.guaranteedCoins.exists(_.outputs.sizeIs >= transfers.size))
            assert(toProve.guaranteedCoins.exists(_.inputs.nonEmpty))
            assert(toProve.guaranteedCoins.exists(_.deltas.toList.forall(_._2 >= BigInt(0))))
            assert(
              toProve.guaranteedCoins.exists(_.deltas.get(invalidTransfer.tokenType).isEmpty),
            )
        }
      }
    }
  }

  test("Fails when no token transfers given") {
    buildWalletTransactionService().use { (walletTransactionService, _) =>
      interceptMessageIO[Throwable](
        "List of token transfers is empty or there is no positive transfers",
      )(walletTransactionService.prepareTransferRecipe(List.empty))
    }
  }

  test("Fails when not enough funds for transfer transaction") {
    forAllF { (transfers: NonEmptyList[domain.TokenTransfer]) =>
      buildWalletTransactionService().use { (walletTransactionService, _) =>
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

        buildWalletTransactionService(initialState).use { (walletTransactionService, _) =>
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
      txWithContextIO.flatMap { case TransactionWithContext(transaction, _, coins) =>
        buildWalletTransactionService().use { (walletTransactionService, _) =>
          walletTransactionService.balanceTransaction(transaction, coins.toList).attempt.map {
            case Left(error) =>
              assert(error.getMessage.startsWith("Not sufficient funds to balance token:"))
            case Right(value) => fail("balanceTransaction without funds must fail")
          }
        }
      }
    }
  }

  test("Reverts applied transaction when proving fails") {
    buildWalletTransactionService(
      generateStateWithFunds(NonEmptyList.one((TokenType.Native, 1_000_000))),
      new FailingProvingService[IO],
    ).use { (walletTransactionService, walletStateContainer) =>
      val randomState = LocalState()
      val randomRecipient = domain.Address(
        Address(randomState.coinPublicKey, randomState.encryptionPublicKey).asString,
      )
      for {
        fiber <- walletStateContainer.subscribe.take(3).compile.toList.start
        _ <- IO.sleep(1.second)
        recipe <- walletTransactionService.prepareTransferRecipe(
          List(domain.TokenTransfer(50_000, TokenType.Native, randomRecipient)),
        )
        _ <- walletTransactionService.proveTransaction(recipe).attempt
        stateUpdates <- fiber.joinWithNever
      } yield {
        val initialState = stateUpdates(0)
        val afterPrepareRecipe = stateUpdates(1)
        val afterApplyFailed = stateUpdates(2)
        assertEquals(
          Wallet.walletCoins.availableCoins(initialState).map(_.nonce),
          Wallet.walletCoins.availableCoins(afterApplyFailed).map(_.nonce),
        )
        assert(
          Wallet.walletCoins.availableCoins(initialState).sizeIs > Wallet.walletCoins
            .availableCoins(afterPrepareRecipe)
            .size,
        )
        assert(
          Wallet.walletBalances
            .balance(initialState)
            .get(TokenType.Native)
            .exists(
              _ > Wallet.walletBalances.balance(afterPrepareRecipe).getOrElse(TokenType.Native, 0),
            ),
        )
      }
    }
  }
}
