package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.wallet.zswap.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.Generators.{
  TransactionWithContext,
  coinInfoArbitrary,
  txWithContextArbitrary,
}
import io.iohk.midnight.wallet.core.WalletTxSubmissionService.{
  TransactionNotWellFormed,
  TransactionRejected,
}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionTracer
import io.iohk.midnight.wallet.core.util.WithProvingServerSuite
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF

class WalletTxSubmissionServiceSpec extends WithProvingServerSuite {

  val noOpTracer: Tracer[IO, StructuredLog] = Tracer.noOpTracer[IO]

  implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[IO] = {
    WalletTxSubmissionTracer.from(noOpTracer)
  }

  private val txSubmissionService = new TxSubmissionServiceStub()
  private val failingTxSubmissionService = new FailingTxSubmissionServiceStub()

  def buildWalletTxSubmissionService[TWallet](
      txSubmissionService: TxSubmissionService[IO] = txSubmissionService,
  ): WalletTxSubmissionService[IO] = {
    new WalletTxSubmissionService.Live[IO, TWallet](
      txSubmissionService,
    )
  }

  test("The first transaction identifier is returned") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, coins) = txWithCtx
        txId <- buildWalletTxSubmissionService().submitTransaction(tx)
      } yield assertEquals(txId.txId, tx.identifiers.head)
    }
  }

  test("Transactions get submitted to the client") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, coins) = txWithCtx
        txId <- buildWalletTxSubmissionService().submitTransaction(tx)
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
          .submitTransaction(invalidTx)
          .intercept[TransactionNotWellFormed] >> IO.unit
      }
    }
  }

  test("Fails when submission fails") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, coins) = txWithCtx
        result <- buildWalletTxSubmissionService(failingTxSubmissionService)
          .submitTransaction(tx)
          .attempt
      } yield assertEquals(result, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError))
    }
  }

  test("Fails when submission is rejected") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, coins) = txWithCtx
        result <- buildWalletTxSubmissionService(new RejectedTxSubmissionServiceStub())
          .submitTransaction(tx)
          .attempt
      } yield assertEquals(
        result,
        Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg)),
      )
    }
  }
}
