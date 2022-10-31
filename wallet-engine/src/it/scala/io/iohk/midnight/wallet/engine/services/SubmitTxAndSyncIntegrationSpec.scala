package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.engine.services.InMemoryServerResource.NodeConfig
import io.iohk.midnight.wallet.ogmios.network.SttpJsonWebSocketClient
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService
import io.iohk.midnight.wallet.ogmios.tracer.ClientRequestResponseTracer
import io.iohk.midnight.wallet.ogmios.tx_submission
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.SubmissionResult
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend

import scala.concurrent.duration.DurationInt

class SubmitTxAndSyncIntegrationSpec extends CatsEffectSuite {

  private val nodePort = 5205
  private val nodeHost = "localhost"
  private val nodeUri = uri"ws://$nodeHost:$nodePort/"

  private val timeout = 30.seconds
  private val sttpBackend = FetchCatsBackend[IO]()

  private implicit val reqRespTracer: ClientRequestResponseTracer[IO] = Tracer.discardTracer[IO]

  private val syncServiceResource =
    SttpJsonWebSocketClient[IO](sttpBackend, nodeUri)
      .map(OgmiosSyncService(_))

  private val txSumbissionServiceResource =
    SttpJsonWebSocketClient[IO](sttpBackend, nodeUri)
      .flatMap(tx_submission.OgmiosTxSubmissionService(_))

  private val inMemoryServerResource =
    InMemoryServerResource.acquire[IO](NodeConfig(nodeHost, nodePort))

  private val environmentResources =
    (inMemoryServerResource, txSumbissionServiceResource, syncServiceResource).parTupled

  def integrationTest(
      title: String,
  )(
      theTest: (OgmiosTxSubmissionService[IO], OgmiosSyncService[IO]) => IO[Unit],
  ): Unit = {
    test(title) {
      environmentResources
        .use { case (_ /* started node */, submitTxService, syncService) =>
          theTest(submitTxService, syncService)
        }
        .timeout(timeout)
    }
  }

  integrationTest("Submit txs and sync blocks") { (submitTxService, syncService) =>
    for {
      r1 <- submitTxService.submitTransaction(Transactions.validDeployTx)
      r2 <- submitTxService.submitTransaction(Transactions.validCallTx)
      blocks <- syncService.sync().take(3).compile.toList
    } yield {
      assertEquals(r1, SubmissionResult.Accepted)
      assertEquals(r2, SubmissionResult.Accepted)
      blocks match {
        case List(block0, block1, block2) =>
          assertEquals(block0.header.height, Block.Height.Genesis)
          assertEquals(block1.header.height, Block.Height.Genesis.increment)
          assertEquals(block2.header.height, Block.Height.Genesis.increment.increment)
        case l =>
          fail(s"Expected 3 blocks but got ${l.toString()}")
      }
      val includedTxs = blocks.flatMap(_.body.transactionResults)
      println(includedTxs)
      assert(includedTxs.contains(Transactions.validDeployTx))
      assert(includedTxs.contains(Transactions.validCallTx))
    }
  }
}
