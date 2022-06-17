package io.iohk.midnight.wallet.services

import cats.effect.IO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.domain.{Block, CallTransaction, DeployTransaction}
import io.iohk.midnight.wallet.examples.Transactions
import io.iohk.midnight.wallet.js.JSLogging.loggingEv
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse.Accepted
import io.iohk.midnight.wallet.tracer.ClientRequestResponseTracer
import munit.CatsEffectSuite
import scala.concurrent.duration.DurationInt
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend

class SyncServiceIntegrationSpec extends CatsEffectSuite {

  val platformUri = uri"ws://localhost:5100/"
  val blocksBufferSize = 100
  val timeout = 30.seconds

  implicit val clientTracer: ClientRequestResponseTracer[IO] = Tracer.discardTracer[IO]

  def integrationTest(title: String)(theTest: SyncService[IO] => IO[Unit]): Unit =
    test(title) {
      PlatformClient
        .Live[IO](FetchCatsBackend[IO](), platformUri)
        .flatMap(SyncService.Live[IO](_, blocksBufferSize))
        .use(theTest)
        .timeout(timeout)
    }

  integrationTest("Submit txs and sync blocks") { syncService =>
    for {
      r1 <- syncService.submitTransaction(Transactions.validDeployTx)
      r2 <- syncService.submitTransaction(Transactions.validCallTx)
      blockStream <- syncService.sync()
      blocks <- blockStream.take(2).compile.toList
    } yield {
      assertEquals(r1, Accepted)
      assertEquals(r2, Accepted)
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
