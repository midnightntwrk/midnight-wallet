package io.iohk.midnight.wallet.core

import cats.effect.{IO, Ref}
import io.iohk.midnight.wallet.core.WalletTxSubmission.TransactionRejected
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import typings.midnightLedger.mod.ZSwapLocalState

class WalletTxSubmissionSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {
  private val txSubmissionService = new TxSubmissionServiceStub()
  private val failingTxSubmissionService = new FailingTxSubmissionServiceStub()
  private val balanceTransactionService = new BalanceTransactionServiceStub()
  private val failingBalanceTransactionServiceStub = new FailingBalanceTransactionServiceStub()
  private val walletState =
    new WalletState.Live[IO](Ref.unsafe(new ZSwapLocalState()), new SyncServiceStub())

  def buildWallet(
      txSubmissionService: TxSubmissionService[IO] = txSubmissionService,
      balanceTransactionService: BalanceTransactionService[IO] = balanceTransactionService,
  ): WalletTxSubmission[IO] =
    new WalletTxSubmission.Live[IO](txSubmissionService, balanceTransactionService, walletState)

  test("The first transaction identifier is returned") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet()
    wallet
      .submitTransaction(tx)
      .map { identifier =>
        assertEquals(
          Option(LedgerSerialization.serializeIdentifier(identifier)),
          tx.identifiers().headOption.map(LedgerSerialization.serializeIdentifier),
        )
      }
  }

  test("Transactions get submitted to the client") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx1, _) = Generators.ledgerTransactionGen.sample.get
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx2, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet()
    for {
      _ <- wallet.submitTransaction(tx1)
      _ <- wallet.submitTransaction(tx2)
      wasSubmitted1 = txSubmissionService.wasTxSubmitted(tx1)
      wasSubmitted2 = txSubmissionService.wasTxSubmitted(tx2)
    } yield assert(wasSubmitted1 && wasSubmitted2)
  }

  test("Fails when submission fails") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet(failingTxSubmissionService)

    wallet
      .submitTransaction(tx)
      .attempt
      .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
  }

  test("Fails when submission is rejected") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet(new RejectedTxSubmissionServiceStub())

    wallet
      .submitTransaction(tx)
      .attempt
      .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
  }

  test("Fails when balancing fails") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet(balanceTransactionService = failingBalanceTransactionServiceStub)

    wallet
      .submitTransaction(tx)
      .attempt
      .map(assertEquals(_, Left(FailingBalanceTransactionServiceStub.error)))
  }
}
