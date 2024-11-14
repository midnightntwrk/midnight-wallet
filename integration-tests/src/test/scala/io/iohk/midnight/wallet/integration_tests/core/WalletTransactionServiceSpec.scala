package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core
import io.iohk.midnight.wallet.core.{
  Generators,
  Snapshot,
  SnapshotInstances,
  WalletInstances,
  WalletStateContainer,
  WalletTransactionService,
  WalletTransactionServiceFactory,
  domain,
  Wallet as CoreWallet,
}
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.tracing.WalletTxServiceTracer
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.given
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.DurationInt
import scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.SeqApply"))
class WalletTransactionServiceSpec extends WithProvingServerSuite {

  private given snapshots: SnapshotInstances[LocalState, Transaction] = new SnapshotInstances
  private val wallets: WalletInstances[
    LocalState,
    Transaction,
    TokenType,
    Offer,
    ProofErasedTransaction,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    CoinPublicKey,
    EncryptionSecretKey,
    EncPublicKey,
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
  ] = new WalletInstances

  import wallets.given

  type Wallet = CoreWallet[LocalState, Transaction]

  private val costModel = TransactionCostModel.dummyTransactionCostModel()
  private val inputFeeOverhead = costModel.inputFeeOverhead
  private val outputFeeOverhead = costModel.outputFeeOverhead

  def buildWalletTransactionService(
      initialState: LocalState = LocalState(),
      prover: ProvingService[IO, UnprovenTransaction, Transaction] = provingService,
  ): Resource[
    IO,
    (
        WalletTransactionService[IO, UnprovenTransaction, Transaction, CoinInfo, TokenType],
        WalletStateContainer[IO, Wallet],
    ),
  ] = {
    val snapshot =
      Snapshot[LocalState, Transaction](
        initialState,
        Seq.empty,
        None,
        ProtocolVersion.V1,
        zswap.NetworkId.Undeployed,
      )
    Bloc[IO, Wallet](walletCreation.create(snapshot)).map { bloc =>
      given WalletTxServiceTracer[IO] = WalletTxServiceTracer.from(Tracer.noOpTracer)
      val walletStateContainer = new WalletStateContainer.Live(bloc)
      val walletTxService =
        new WalletTransactionServiceFactory[
          IO,
          Wallet,
          UnprovenTransaction,
          Transaction,
          CoinInfo,
          TokenType,
        ].create(walletStateContainer, prover)
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
    forAllF { (transfers: NonEmptyList[domain.TokenTransfer[TokenType]]) =>
      val initialState = Generators.generateStateWithFunds(
        transfers
          .map(tt => (tt.tokenType, tt.amount * tt.amount + tt.amount))
          .prepend(nativeToken(), (inputFeeOverhead * outputFeeOverhead).toScalaBigInt),
      )
      buildWalletTransactionService(initialState).use { (walletTransactionService, _) =>
        walletTransactionService.prepareTransferRecipe(transfers.toList).map {
          case domain.TransactionToProve(toProve) =>
            assert(toProve.guaranteedCoins.exists(_.outputs.length >= transfers.size))
            assert(toProve.guaranteedCoins.exists(_.inputs.nonEmpty))
            assert(toProve.guaranteedCoins.exists(_.deltas.toList.forall(_._2 >= js.BigInt(0))))
        }
      }
    }
  }

  test("Prepare recipe for balanced transfer transaction and filter out negative transfers") {
    forAllF { (transfers: NonEmptyList[domain.TokenTransfer[TokenType]]) =>
      val invalidTransfer =
        domain.TokenTransfer[TokenType](BigInt(-1), "invalid", domain.Address("invalid"))
      val initialState = Generators.generateStateWithFunds(
        transfers
          .map(tt => (tt.tokenType, tt.amount * tt.amount + tt.amount))
          .prepend(nativeToken(), (inputFeeOverhead * outputFeeOverhead).toScalaBigInt),
      )
      buildWalletTransactionService(initialState).use { (walletTransactionService, _) =>
        walletTransactionService.prepareTransferRecipe(invalidTransfer :: transfers.toList).map {
          case domain.TransactionToProve(toProve) =>
            assert(toProve.guaranteedCoins.exists(_.outputs.sizeIs >= transfers.size))
            assert(toProve.guaranteedCoins.exists(_.inputs.nonEmpty))
            assert(toProve.guaranteedCoins.exists(_.deltas.toList.forall(_._2 >= js.BigInt(0))))
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
    forAllF { (transfers: NonEmptyList[domain.TokenTransfer[TokenType]]) =>
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
            .map(coin => (coin.tokenType, (coin.value * coin.value + coin.value).toScalaBigInt))
            .prepend(nativeToken(), (inputFeeOverhead * outputFeeOverhead).toScalaBigInt),
        )

        buildWalletTransactionService(initialState).use { (walletTransactionService, _) =>
          walletTransactionService.balanceTransaction(transaction, coins.toList).map {
            case domain.BalanceTransactionToProve(toProve, toBalance) =>
              assertEquals(toBalance, transaction)
              val balancedTransaction = transaction.eraseProofs().merge(toProve.eraseProofs())
              assert(
                balancedTransaction
                  .imbalances(true, balancedTransaction.fees(LedgerParameters.dummyParameters()))
                  .toList
                  .forall(_._2 >= js.BigInt(0)),
              )
              assert(balancedTransaction.imbalances(false).toList.forall(_._2 >= js.BigInt(0)))
            case domain.NothingToProve(_) =>
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
            case Right(_) => fail("balanceTransaction without funds must fail")
          }
        }
      }
    }
  }

  test("Reverts applied transaction when proving fails") {
    buildWalletTransactionService(
      generateStateWithFunds(NonEmptyList.one((nativeToken(), 1_000_000))),
      new FailingProvingService[IO],
    ).use { (walletTransactionService, walletStateContainer) =>
      val randomState = LocalState()
      val randomRecipient = domain.Address(
        zswap
          .Address[CoinPublicKey, EncPublicKey](
            randomState.coinPublicKey,
            randomState.encryptionPublicKey,
          )
          .asString,
      )
      for {
        fiber <- walletStateContainer.subscribe.take(3).compile.toList.start
        _ <- IO.sleep(1.second)
        recipe <- walletTransactionService.prepareTransferRecipe(
          List(domain.TokenTransfer(50_000, nativeToken(), randomRecipient)),
        )
        _ <- walletTransactionService.proveTransaction(recipe).attempt
        stateUpdates <- fiber.joinWithNever
      } yield {
        val initialState = stateUpdates(0)
        val afterPrepareRecipe = stateUpdates(1)
        val afterApplyFailed = stateUpdates(2)
        assertEquals(
          walletCoins.availableCoins(initialState).map(_.nonce),
          walletCoins.availableCoins(afterApplyFailed).map(_.nonce),
        )
        assert(
          walletCoins.availableCoins(initialState).sizeIs > walletCoins
            .availableCoins(afterPrepareRecipe)
            .size,
        )
        assert(
          walletBalances
            .balance(initialState)
            .get(nativeToken())
            .exists(
              _ > walletBalances.balance(afterPrepareRecipe).getOrElse(nativeToken(), 0),
            ),
        )
      }
    }
  }
}
