package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.wallet.core.Generators.{TransactionWithContext, coinInfoGen}
import io.iohk.midnight.wallet.core.WalletTxSubmission.{
  TransactionNotWellFormed,
  TransactionRejected,
}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import scala.scalajs.js
import typings.midnightLedger.mod.*

class WalletTxSubmissionSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {
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
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx, _, coins) = Generators.generateLedgerTransaction()
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

  test("The wallet state was updated") {
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx, _, coins) = Generators.generateLedgerTransaction()
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

  test("Transactions get submitted to the client") {
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx1, _, coins1) = Generators.generateLedgerTransaction()
    val TransactionWithContext(tx2, _, coins2) = Generators.generateLedgerTransaction()
    val wallet = buildWallet()
    for {
      _ <- wallet.submitTransaction(tx1, coins1)
      _ <- wallet.submitTransaction(tx2, coins2)
      wasSubmitted1 = txSubmissionService.wasTxSubmitted(tx1)
      wasSubmitted2 = txSubmissionService.wasTxSubmitted(tx2)
    } yield assert(wasSubmitted1 && wasSubmitted2)
  }

  test("Fails when received transaction is not well formed") {
    val builder = new TransactionBuilder(new LedgerState())
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val coin = coinInfoGen.sample.get
    val output = ZSwapOutputWithRandomness.`new`(coin, new ZSwapLocalState().coinPublicKey)
    // offer with output, but with empty deltas
    val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), new ZSwapDeltas())
    builder.addOffer(offer, output.randomness)
    val wallet = buildWallet()
    val invalidTx = builder.intoTransaction().transaction

    wallet
      .submitTransaction(invalidTx, List.empty)
      .intercept[TransactionNotWellFormed]
  }

  test("Fails when submission fails") {
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx, _, coins) = Generators.generateLedgerTransaction()
    val wallet = buildWallet(failingTxSubmissionService)

    wallet
      .submitTransaction(tx, coins)
      .attempt
      .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
  }

  test("Fails when submission is rejected") {
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx, _, coins) = Generators.generateLedgerTransaction()
    val wallet = buildWallet(new RejectedTxSubmissionServiceStub())

    wallet
      .submitTransaction(tx, coins)
      .attempt
      .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
  }

  test("Fails when balancing fails") {
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx, _, coins) = Generators.generateLedgerTransaction()
    val wallet = buildWallet(balanceTransactionService = failingBalanceTransactionServiceStub)

    wallet
      .submitTransaction(tx, coins)
      .attempt
      .map(assertEquals(_, Left(FailingBalanceTransactionServiceStub.error)))
  }

  test("Fails when updating state fails") {
    // Taking just a sample because tx building is slow
    val TransactionWithContext(tx, _, coins) = Generators.generateLedgerTransaction()
    val wallet = buildWallet(walletState = new FailingWalletStateStub())

    wallet
      .submitTransaction(tx, coins)
      .attempt
      .map(assertEquals(_, Left(FailingWalletStateStub.error)))
  }
}
