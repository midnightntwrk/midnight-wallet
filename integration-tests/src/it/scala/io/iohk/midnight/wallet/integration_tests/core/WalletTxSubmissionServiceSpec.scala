package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.IO
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.{
  Wallet,
  WalletStateContainer,
  WalletTransactionService,
  WalletTxSubmissionService,
  domain,
}
import io.iohk.midnight.wallet.core.WalletTxSubmissionService.{
  TransactionNotWellFormed,
  TransactionRejected,
  TransactionSubmissionFailed,
}
import io.iohk.midnight.wallet.core.capabilities.{WalletCreation, WalletTxBalancing}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.{WalletTxServiceTracer, WalletTxSubmissionTracer}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.DurationInt

@SuppressWarnings(Array("org.wartremover.warts.SeqApply"))
class WalletTxSubmissionServiceSpec extends WithProvingServerSuite {

  val noOpTracer: Tracer[IO, StructuredLog] = Tracer.noOpTracer[IO]

  implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[IO] = {
    WalletTxSubmissionTracer.from(noOpTracer)
  }

  private val txSubmissionService = new TxSubmissionServiceStub()
  private val failingTxSubmissionService = new FailingTxSubmissionServiceStub()

  import Wallet.*

  def buildWalletTxSubmissionService[TWallet](
      initialState: LocalState = LocalState(),
      txSubmissionService: TxSubmissionService[IO] = txSubmissionService,
  )(using
      walletCreation: WalletCreation[TWallet, Wallet.Snapshot],
      walletTxBalancing: WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, _],
  ): IO[(WalletTxSubmissionService[IO], WalletStateContainer[IO, TWallet])] = {
    val snapshot = Wallet.Snapshot(initialState, Seq.empty, None)
    Bloc[IO, TWallet](walletCreation.create(snapshot)).allocated.map(_._1).map { bloc =>
      val walletStateContainer = new WalletStateContainer.Live(bloc)
      val service =
        new WalletTxSubmissionService.Live[IO, TWallet](txSubmissionService, walletStateContainer)
      (service, walletStateContainer)
    }
  }

  test("The first transaction identifier is returned") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService().map(_._1)
        txId <- service.submitTransaction(tx)
      } yield assertEquals(txId.txId, tx.identifiers.head)
    }
  }

  test("Transactions get submitted to the client") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService().map(_._1)
        _ <- service.submitTransaction(tx)
      } yield assert(txSubmissionService.wasTxSubmitted(tx))
    }
  }

  test("Fails when received transaction is not well formed") {
    val state = LocalState()
    forAllF(coinInfoArbitrary.arbitrary, Gen.posNum[Int]) { (coin, amount) =>
      val output = UnprovenOutput(coin, state.coinPublicKey, state.encryptionPublicKey)
      // offer with output, but with not the same amount of coins in deltas
      val offer = UnprovenOffer.fromOutput(output, coin.tokenType, coin.value - BigInt(amount))

      val invalidTxIO = provingService.proveTransaction(UnprovenTransaction(offer))

      invalidTxIO.flatMap { invalidTx =>
        buildWalletTxSubmissionService()
          .map(_._1)
          .flatMap(
            _.submitTransaction(invalidTx)
              .intercept[TransactionNotWellFormed] >> IO.unit,
          )
      }
    }
  }

  test("Fails when submission fails") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService(txSubmissionService = failingTxSubmissionService)
          .map(_._1)
        result <- service.submitTransaction(tx).attempt
      } yield {
        assertEquals(
          result,
          Left(TransactionSubmissionFailed(FailingTxSubmissionServiceStub.TxSubmissionServiceError)),
        )
      }
    }
  }

  test("Recovers funds when submission is rejected") {
    given WalletTxServiceTracer[IO] = WalletTxServiceTracer.from(Tracer.noOpTracer)
    val randomRecipient = {
      val randomLocalState = LocalState()
      domain.Address(
        Address(randomLocalState.coinPublicKey, randomLocalState.encryptionPublicKey).asString,
      )
    }
    for {
      tuple <- buildWalletTxSubmissionService(
        initialState = generateStateWithFunds(NonEmptyList.one((TokenType.Native, 100_000))),
        txSubmissionService = new RejectedTxSubmissionServiceStub(),
      )
      (service, stateContainer) = tuple
      fiber <- stateContainer.subscribe.take(3).compile.toList.start
      _ <- IO.sleep(1.second)
      txService = new WalletTransactionService.Live[IO, Wallet](stateContainer, provingService)
      unProvenTx <- txService.prepareTransferRecipe(
        List(domain.TokenTransfer(50000, TokenType.Native, randomRecipient)),
      )
      tx <- txService.proveTransaction(unProvenTx)
      _ <- service.submitTransaction(tx).attempt
      stateUpdates <- fiber.joinWithNever
    } yield {
      val balances = stateUpdates.flatMap(Wallet.walletBalances.balance(_).get(TokenType.Native))
      val availableCoins = stateUpdates.map(Wallet.walletCoins.availableCoins)
      assertEquals(balances.headOption, balances.lastOption)
      assert(balances(0) > balances(1))
      assertEquals(availableCoins(0).map(_.nonce), availableCoins(2).map(_.nonce))
      assert(availableCoins(0).sizeIs > availableCoins(1).size)
    }
  }

  test("Fails when submission is rejected") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService(txSubmissionService =
          new RejectedTxSubmissionServiceStub(),
        ).map(_._1)
        result <- service.submitTransaction(tx).attempt
      } yield assertEquals(
        result,
        Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg)),
      )
    }
  }
}
