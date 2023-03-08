package io.iohk.midnight.wallet.core

import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.Generators.{
  TransactionWithContext,
  coinInfoGen,
  ledgerTransactionGen,
}
import io.iohk.midnight.wallet.core.WalletTxSubmissionService.{
  TransactionNotWellFormed,
  TransactionRejected,
}
import io.iohk.midnight.wallet.core.capabilities.{WalletCreation, WalletTxBalancing}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.{BalanceTransactionTracer, WalletTxSubmissionTracer}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

import scala.scalajs.js

class WalletTxSubmissionServiceSpec
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

  private def walletStateContainerFactory[TWallet](state: ZSwapLocalState)(implicit
      walletCreation: WalletCreation[TWallet, ZSwapLocalState],
  ) =
    Bloc[IO, TWallet](walletCreation.create(state)).map(new WalletStateContainer.Live(_))

  private def generateStateWithFunds(forTransaction: Transaction) = {
    val imbalance = forTransaction.imbalances().pop().imbalance
    Generators.generateStateWithFunds(imbalance * imbalance)
  }

  def buildWalletTxSubmissionService[TWallet](
      forTransaction: Transaction,
      txSubmissionService: TxSubmissionService[IO] = txSubmissionService,
  )(implicit
      walletTxBalancing: WalletTxBalancing[TWallet, Transaction, CoinInfo],
      walletCreation: WalletCreation[TWallet, ZSwapLocalState],
  ): Resource[IO, WalletTxSubmissionService[IO]] = {
    val stateWithFunds = generateStateWithFunds(forTransaction)
    walletStateContainerFactory(stateWithFunds).map { wsc =>
      new WalletTxSubmissionService.Live[IO, TWallet](
        txSubmissionService,
        wsc,
      )
    }
  }

  import Wallet.*

  test("The first transaction identifier is returned") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      buildWalletTxSubmissionService(tx).use(
        _.submitTransaction(tx, coins)
          .map { identifier =>
            assertEquals(
              Option(LedgerSerialization.serializeIdentifier(identifier)),
              tx.identifiers().headOption.map(LedgerSerialization.serializeIdentifier),
            )
          },
      )
    }
  }

  test("Transactions get submitted to the client") {
    val walletTxBalancingStub: WalletTxBalancing[Wallet, Transaction, CoinInfo] =
      (wallet: Wallet, transactionWithCoins: (Transaction, Seq[CoinInfo])) =>
        Right((wallet, transactionWithCoins._1))

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      buildWalletTxSubmissionService(tx)(walletTxBalancingStub, walletCreation).use(wallet =>
        for {
          _ <- wallet.submitTransaction(tx, coins)
          wasSubmitted = txSubmissionService.wasTxSubmitted(tx)
        } yield assert(wasSubmitted),
      )
    }
  }

  test("The wallet state was updated") {
    import cats.syntax.either.*
    forAllF(ledgerTransactionGen) { txWithCtx =>
      case class TestingWallet(state: ZSwapLocalState)
      implicit val walletTxBalancing: WalletTxBalancing[TestingWallet, Transaction, CoinInfo] =
        (wallet: TestingWallet, transactionWithCoins: (Transaction, Seq[CoinInfo])) =>
          TransactionBalancer
            .balanceTransaction(wallet.state, transactionWithCoins._1)
            .map { case (tx, state) => (TestingWallet(state), tx) }
            .leftMap(_ => WalletError.NotSufficientFunds)
      val TransactionWithContext(tx, _, coins) = txWithCtx
      val stateWithFunds = generateStateWithFunds(tx)
      val walletStateContainerRef =
        Bloc[IO, TestingWallet](TestingWallet(stateWithFunds)).map(new WalletStateContainer.Live(_))
      walletStateContainerRef.use(wsc => {
        val wallet =
          new WalletTxSubmissionService.Live[IO, TestingWallet](
            txSubmissionService,
            wsc,
          )

        wallet
          .submitTransaction(tx, coins)
          .flatMap(_ => wsc.subscribe.head.compile.lastOrError)
          .map { updatedState =>
            assert(updatedState.state.pendingSpends.keys().length > 0)
          }
      })
    }
  }

  test("Fails when received transaction is not well formed") {
    val builder = new TransactionBuilder(new LedgerState())

    forAllF(coinInfoGen) { coin =>
      val output = ZSwapOutputWithRandomness.`new`(coin, new ZSwapLocalState().coinPublicKey)
      // offer with output, but with empty deltas
      val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), new ZSwapDeltas())
      builder.addOffer(offer, output.randomness)
      val invalidTx = builder.intoTransaction().transaction

      buildWalletTxSubmissionService(invalidTx).use(
        _.submitTransaction(invalidTx, List.empty)
          .intercept[TransactionNotWellFormed] >> IO.unit,
      )
    }
  }

  test("Fails when submission fails") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      buildWalletTxSubmissionService(tx, txSubmissionService = failingTxSubmissionService).use(
        _.submitTransaction(tx, coins).attempt
          .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError))),
      )
    }
  }

  test("Fails when submission is rejected") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      buildWalletTxSubmissionService(
        tx,
        txSubmissionService = new RejectedTxSubmissionServiceStub(),
      ).use(
        _.submitTransaction(tx, coins).attempt
          .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg)))),
      )
    }
  }

  test("Fails when balancing fails") {
    val failingWalletTxBalancing: WalletTxBalancing[Wallet, Transaction, CoinInfo] =
      (_: Wallet, _: (Transaction, Seq[CoinInfo])) => Left(WalletError.NotSufficientFunds)

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx

      buildWalletTxSubmissionService(tx)(failingWalletTxBalancing, Wallet.walletCreation).use(
        _.submitTransaction(tx, coins).attempt
          .map {
            case Left(error) =>
              assertEquals(error.getMessage, WalletError.NotSufficientFunds.toString)
            case Right(_) => fail("Submitting tx should fail")
          },
      )
    }
  }

  test("Fails when updating state fails") {
    val wallet = new WalletTxSubmissionService.Live[IO, Wallet](
      txSubmissionService,
      new FailingWalletStateContainerStub[Wallet](),
    )

    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx

      wallet
        .submitTransaction(tx, coins)
        .attempt
        .map(assertEquals(_, Left(FailingWalletStateContainerStub.error)))
    }
  }
}
