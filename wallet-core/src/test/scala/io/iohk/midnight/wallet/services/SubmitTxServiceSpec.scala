package io.iohk.midnight.wallet.services

import cats.effect.IO
import cats.syntax.eq.*
import cats.syntax.functor.*
import cats.syntax.parallel.*
import io.iohk.midnight.wallet.clients.platform.PlatformClientStub
import io.iohk.midnight.wallet.clients.platform.examples.SubmitTx
import io.iohk.midnight.wallet.domain.Transaction
import io.iohk.midnight.wallet.js.JSLogging.loggingEv
import io.iohk.midnight.wallet.services.SubmitTxService.SubmissionResponse
import io.iohk.midnight.wallet.services.SubmitTxService.SubmissionResponse.{Accepted, Rejected}
import io.iohk.midnight.wallet.services.SubmitTxServiceSpec.transactionsGen
import io.iohk.midnight.wallet.util.BetterOutputSuite
import io.iohk.midnight.wallet.util.implicits.Equality.*
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF

trait SubmitTxServiceSpecBase
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {
  def testService(
      title: String,
  )(theTest: (SubmitTxService[IO], PlatformClientStub) => PropF[IO]): Unit =
    test(title) {
      PlatformClientStub()
        .fproduct(SubmitTxService.Live[IO](_))
        .flatMap { case (platformClient, submitTxService) =>
          submitTxService.use(theTest(_, platformClient).checkOne())
        }
    }
}

class SubmitTxServiceSpec extends SubmitTxServiceSpecBase {
  testService("Submits txs and receives corresponding responses") { (submitTxService, _) =>
    forAllF(transactionsGen) { transactions =>
      submitTransactionsAndVerifyResponses(transactions, submitTxService)
    }
  }

  private def submitTransactionsAndVerifyResponses(
      transactions: Seq[Transaction],
      submitTxService: SubmitTxService[IO],
  ): IO[Unit] =
    transactions
      .fproduct[SubmissionResponse] { tx =>
        if (tx === SubmitTx.validCallObject.payload) Accepted
        else Rejected(PlatformClientStub.rejectDetails.reason)
      }
      .parTraverse { case (tx, expected) =>
        submitTxService.submitTransaction(tx).map(assertEquals(_, expected))
      }
      .void
}

object SubmitTxServiceSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(
      Gen.oneOf(SubmitTx.validDeployObject.payload, SubmitTx.validCallObject.payload),
    )
}
