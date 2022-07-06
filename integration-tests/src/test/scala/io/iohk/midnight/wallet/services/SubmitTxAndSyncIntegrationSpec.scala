package io.iohk.midnight.wallet.services

import cats.syntax.all.*
import cats.effect.IO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.domain.services.SyncService
import io.iohk.midnight.wallet.domain.{Block, CallTransaction, DeployTransaction}
import io.iohk.midnight.wallet.examples.Transactions
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService
import io.iohk.midnight.wallet.tracer.ClientRequestResponseTracer
import io.iohk.midnight.wallet.ogmios.sync
import io.iohk.midnight.wallet.ogmios.tx_submission
import munit.CatsEffectSuite

import scala.concurrent.duration.DurationInt
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend
import io.iohk.midnight.wallet.domain.services.TxSubmissionService
import io.iohk.midnight.wallet.domain.services.TxSubmissionService.SubmissionResult

class SubmitTxAndSyncIntegrationSpec extends CatsEffectSuite {

  private val platformUri = uri"ws://localhost:5100/"
  private val timeout = 30.seconds
  private val sttpBackend = FetchCatsBackend[IO]()

  private implicit val clientTracer: ClientRequestResponseTracer[IO] = Tracer.discardTracer[IO]

  private val syncServiceResource =
    sync.util.json.SttpJsonWebSocketClient[IO](sttpBackend, platformUri).map(OgmiosSyncService(_))
  private val txSumbissionServiceResource = tx_submission.util.json
    .SttpJsonWebSocketClient[IO](sttpBackend, platformUri)
    .flatMap(tx_submission.OgmiosTxSubmissionService(_))
  private val servicesResource = (txSumbissionServiceResource, syncServiceResource).parTupled

  def integrationTest(
      title: String,
  )(theTest: (TxSubmissionService[IO], SyncService[IO]) => IO[Unit]): Unit = {
    test(title) {
      servicesResource
        .use { case (submitTxService, syncService) =>
          theTest(submitTxService, syncService)
        }
        .timeout(timeout)
    }
  }

  integrationTest("Submit txs and sync blocks") { (submitTxService, syncService) =>
    for {
      r1 <- submitTxService.submitTransaction(Transactions.validDeployTx)
      r2 <- submitTxService.submitTransaction(Transactions.validCallTx)
      blocks <- syncService.sync().take(2).compile.toList
    } yield {
      assertEquals(r1, SubmissionResult.Accepted)
      assertEquals(r2, SubmissionResult.Accepted)
      blocks match {
        case List(block0, block1) =>
          assertEquals(block0.header.height, Block.Height.Genesis)
          assertEquals(block1.header.height, Block.Height.Genesis.increment)
        case l =>
          fail(s"Expected 2 blocks but got ${l.toString()}")
      }
      val includedTxs = blocks.flatMap(_.transactions.map(_.transaction))
      val deployTxs = includedTxs.collect { case d: DeployTransaction => d }
      val callTxs = includedTxs.collect { case c: CallTransaction => c }
      assert(deployTxs.contains(Transactions.validDeployTx))
      assert(callTxs.contains(Transactions.validCallTx))
    }
  }
}
