package io.iohk.midnight.wallet.ouroboros.tx_submission

import cats.effect.IO
import cats.syntax.eq.*
import cats.syntax.functor.*
import cats.syntax.parallel.*
import io.iohk.midnight.tracer.logging.{InMemoryLogTracer, StringLogContext, StructuredLog}
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService.SubmissionResult.{
  Accepted,
  Rejected,
}
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionSpec.transactionsGen
import io.iohk.midnight.wallet.ouroboros.tx_submission.TestDomain.Transaction
import io.iohk.midnight.wallet.ouroboros.tx_submission.TestDomain.Transaction.*
import io.iohk.midnight.wallet.ouroboros.tx_submission.examples.SubmitTx
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Receive
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Receive.AcceptTx
import io.iohk.midnight.wallet.ouroboros.tx_submission.tracing.{
  OuroborosTxSubmissionEvent,
  OuroborosTxSubmissionTracer,
}
import io.iohk.midnight.wallet.ouroboros.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF

import java.util.concurrent.TimeUnit
import scala.concurrent.duration.FiniteDuration

trait TxSubmissionSpecBase
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  val delay: FiniteDuration = FiniteDuration(100, TimeUnit.MILLISECONDS)

  def submitTransactionsAndVerifyResponses(
      transactions: Seq[Transaction],
      syncService: OuroborosTxSubmissionService[IO, Transaction],
  ): IO[Unit] =
    transactions
      .fproduct[SubmissionResult] { tx =>
        if (tx === SubmitTx.validCallObject.payload) Accepted
        else Rejected(JsonWebSocketClientTxSubmissionStub.rejectDetails.reason)
      }
      .parTraverse { case (tx, expected) =>
        syncService.submitTransaction(tx).assertEquals(expected)
      }
      .void

  def testService(
      title: String,
      initialResponses: Seq[Receive] = Seq.empty,
  )(
      theTest: (
          OuroborosTxSubmissionService[IO, Transaction],
          JsonWebSocketClientTxSubmissionStub,
          InMemoryLogTracer[IO, StructuredLog],
      ) => PropF[IO],
  ): Unit =
    test(title) {
      JsonWebSocketClientTxSubmissionStub(initialResponses = initialResponses)
        .fproduct { webSocketClient =>
          val inMemoryTracer = InMemoryLogTracer.unsafeContextAware[IO, StringLogContext]
          implicit val txSubmissionTracer: OuroborosTxSubmissionTracer[IO] =
            OuroborosTxSubmissionTracer.from(inMemoryTracer)
          (OuroborosTxSubmissionService[IO, Transaction](webSocketClient), inMemoryTracer)
        }
        .flatMap { case (nodeClient, (txSubmissionService, tracer)) =>
          txSubmissionService.use(theTest(_, nodeClient, tracer).checkOne())
        }
    }
}

class OuroborosTxSubmissionSpec extends TxSubmissionSpecBase {
  testService("Submits txs and receives corresponding responses") { (syncService, _, _) =>
    forAllF(transactionsGen) { transactions =>
      submitTransactionsAndVerifyResponses(transactions, syncService)
    }
  }

  testService("Receives response before sending anything", initialResponses = Seq(AcceptTx)) {
    (_, _, tracer) =>
      val foundExpectedLog = tracer
        .getById(OuroborosTxSubmissionEvent.ProcessingReceivedMessageFailed.id)
        .delayBy(delay)
        .map(_.nonEmpty)

      assertIOBoolean(foundExpectedLog)
  }
}

object OuroborosTxSubmissionSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(Gen.const(SubmitTx.validCallObject.payload))
}
