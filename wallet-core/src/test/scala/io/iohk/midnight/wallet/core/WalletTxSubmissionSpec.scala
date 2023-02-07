package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.Generators.TransactionWithContext
import io.iohk.midnight.wallet.core.Generators.coinInfoGen
import io.iohk.midnight.wallet.core.Generators.ledgerTransactionGen
import io.iohk.midnight.wallet.core.WalletTxSubmission.TransactionNotWellFormed
import io.iohk.midnight.wallet.core.WalletTxSubmission.TransactionRejected
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.BalanceTransactionTracer
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionTracer
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite
import munit.ScalaCheckEffectSuite
import org.scalacheck.effect.PropF.forAllF

import scala.scalajs.js

class WalletTxSubmissionSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  val noOpTracer: Tracer[IO, StructuredLog] = Tracer.noOpTracer[IO]

  implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[IO] = {
    WalletTxSubmissionTracer.from(noOpTracer)
  }

  implicit val balanceTxTracer: BalanceTransactionTracer[IO] =
    BalanceTransactionTracer.from(noOpTracer)

  private val txSubmissionService = new TxSubmissionServiceStub()
  private val failingTxSubmissionService = new FailingTxSubmissionServiceStub()
  private val balanceTransactionService = new BalanceTransactionServiceStub()
  private val failingBalanceTransactionServiceStub = new FailingBalanceTransactionServiceStub()
  private val walletState = new WalletStateStub()

  def buildWallet(
      txSubmissionService: TxSubmissionService[IO] = txSubmissionService,
      balanceTransactionService: BalanceTransactionService[IO] = balanceTransactionService,
      walletState: WalletState[IO] = walletState,
  ): WalletTxSubmission[IO] =
    new WalletTxSubmission.Live[IO](txSubmissionService, balanceTransactionService, walletState)

  test("The first transaction identifier is returned") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      val wallet = buildWallet()
      wallet
        .submitTransaction(tx, coins)
        .map { identifier =>
          assertEquals(
            Option(LedgerSerialization.serializeIdentifier(identifier)),
            tx.identifiers().headOption.map(LedgerSerialization.serializeIdentifier),
          )
        }
    }
  }

  test("The wallet state was updated") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      val imbalance = tx.imbalances().pop().imbalance
      val stateWithFunds = Generators.generateStateWithFunds(imbalance * imbalance)
      val walletState = new WalletStateStub(stateWithFunds)
      val wallet =
        buildWallet(
          balanceTransactionService = new BalanceTransactionService.Live[IO](),
          walletState = walletState,
        )
      wallet
        .submitTransaction(tx, coins)
        .flatMap(_ => walletState.localState)
        .map { updatedState =>
          assert(updatedState.pendingSpends.keys().length > 0)
        }
    }
  }

  test("Transactions get submitted to the client") {
    val wallet = buildWallet()

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      for {
        _ <- wallet.submitTransaction(tx, coins)
        wasSubmitted = txSubmissionService.wasTxSubmitted(tx)
      } yield assert(wasSubmitted)
    }
  }

  test("Fails when received transaction is not well formed") {
    val builder = new TransactionBuilder(new LedgerState())

    forAllF(coinInfoGen) { coin =>
      val output = ZSwapOutputWithRandomness.`new`(coin, new ZSwapLocalState().coinPublicKey)
      // offer with output, but with empty deltas
      val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), new ZSwapDeltas())
      builder.addOffer(offer, output.randomness)
      val wallet = buildWallet()
      val invalidTx = builder.intoTransaction().transaction

      wallet
        .submitTransaction(invalidTx, List.empty)
        .intercept[TransactionNotWellFormed] >> IO.unit
    }
  }

  test("Fails when submission fails") {
    val wallet = buildWallet(failingTxSubmissionService)

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      wallet
        .submitTransaction(tx, coins)
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("Fails when submission is rejected") {
    val wallet = buildWallet(new RejectedTxSubmissionServiceStub())

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      wallet
        .submitTransaction(tx, coins)
        .attempt
        .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
    }
  }

  test("Fails when balancing fails") {
    val wallet = buildWallet(balanceTransactionService = failingBalanceTransactionServiceStub)

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx

      wallet
        .submitTransaction(tx, coins)
        .attempt
        .map(assertEquals(_, Left(FailingBalanceTransactionServiceStub.error)))
    }
  }

  test("Fails when updating state fails") {
    val wallet = buildWallet(walletState = new FailingWalletStateStub())

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx

      wallet
        .submitTransaction(tx, coins)
        .attempt
        .map(assertEquals(_, Left(FailingWalletStateStub.error)))
    }
  }
}
