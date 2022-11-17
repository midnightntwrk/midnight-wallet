package io.iohk.midnight.wallet.ogmios.tx_submission

import cats.effect.IO
import cats.syntax.eq.*
import cats.syntax.functor.*
import cats.syntax.parallel.*
import io.iohk.midnight.tracer.logging.{ContextAwareLog, InMemoryLogTracer}
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.blockchain.util.implicits.Equality.*
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.SubmissionResult.{
  Accepted,
  Rejected,
}
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionSpec.transactionsGen
import io.iohk.midnight.wallet.ogmios.tx_submission.examples.SubmitTx
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Receive
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Receive.AcceptTx
import io.iohk.midnight.wallet.ogmios.tx_submission.tracing.{
  OgmiosTxSubmissionEvent,
  OgmiosTxSubmissionTracer,
}
import io.iohk.midnight.wallet.ogmios.util.BetterOutputSuite
import java.util.concurrent.TimeUnit
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.FiniteDuration

trait TxSubmissionSpecBase
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  val delay: FiniteDuration = FiniteDuration(100, TimeUnit.MILLISECONDS)

  def submitTransactionsAndVerifyResponses(
      transactions: Seq[Transaction],
      syncService: OgmiosTxSubmissionService[IO],
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
          OgmiosTxSubmissionService[IO],
          JsonWebSocketClientTxSubmissionStub,
          InMemoryLogTracer[IO, ContextAwareLog],
      ) => PropF[IO],
  ): Unit =
    test(title) {
      JsonWebSocketClientTxSubmissionStub(initialResponses = initialResponses)
        .fproduct { webSocketClient =>
          val inMemoryTracer = InMemoryLogTracer.unsafeContextAware[IO]
          implicit val txSubmissionTracer: OgmiosTxSubmissionTracer[IO] =
            OgmiosTxSubmissionTracer.from(inMemoryTracer)
          (OgmiosTxSubmissionService[IO](webSocketClient), inMemoryTracer)
        }
        .flatMap { case (nodeClient, (txSubmissionService, tracer)) =>
          txSubmissionService.use(theTest(_, nodeClient, tracer).checkOne())
        }
    }
}

class OgmiosTxSubmissionSpec extends TxSubmissionSpecBase {
  testService("Submits txs and receives corresponding responses") { (syncService, _, _) =>
    forAllF(transactionsGen) { transactions =>
      submitTransactionsAndVerifyResponses(transactions, syncService)
    }
  }

  testService("Receives response before sending anything", initialResponses = Seq(AcceptTx)) {
    (_, _, tracer) =>
      val foundExpectedLog = tracer
        .getById(OgmiosTxSubmissionEvent.ProcessingReceivedMessageFailed.id)
        .delayBy(delay)
        .map(_.nonEmpty)

      assertIOBoolean(foundExpectedLog)
  }
}

object OgmiosTxSubmissionSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(Gen.const(SubmitTx.validCallObject.payload))
}
