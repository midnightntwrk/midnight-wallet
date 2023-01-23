package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as ApiTransaction
import io.iohk.midnight.midnightMockedNodeApp.anon.PartialConfigTransaction
import io.iohk.midnight.midnightMockedNodeApp.distConfigMod.GenesisValue
import io.iohk.midnight.midnightMockedNodeApp.mod.InMemoryServer
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.{ContextAwareLog, StringLogContext}
import io.iohk.midnight.wallet.blockchain.data.Transaction.Header
import io.iohk.midnight.wallet.blockchain.data.{Hash, Transaction}
import io.iohk.midnight.wallet.core.Instances.*
import io.iohk.midnight.wallet.ouroboros
import io.iohk.midnight.wallet.ouroboros.network.JsonWebSocketClientTracer
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService
import io.iohk.midnight.wallet.ouroboros.tx_submission.tracing.OuroborosTxSubmissionTracer
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.ws.WebSocketClosed

import scala.scalajs.js.JSConverters.*

class OuroborosTxSubmissionServiceSpec extends CatsEffectSuite {

  test("Submit TX when socket is not available should raise an exception") {
    val nodeHost = "localhost"
    val nodePort = 5205L

    val sttpBackend = FetchCatsBackend[IO]()

    implicit val contextAwareLogTracer: Tracer[IO, ContextAwareLog[StringLogContext]] =
      Tracer.noOpTracer
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[IO] =
      JsonWebSocketClientTracer.from(contextAwareLogTracer)
    implicit val ouroborosTxSubmissionTracer: OuroborosTxSubmissionTracer[IO] =
      OuroborosTxSubmissionTracer.from(contextAwareLogTracer)

    val nodeConfig =
      PartialConfigTransaction()
        .setGenesis(GenesisValue("value", Seq.empty[ApiTransaction].toJSArray))
        .setHost(nodeHost)
        .setPort(nodePort.toDouble)

    // Starting up a Node so the 'SttpJsonWebSocketClient' can do a initial connect.
    val node = new InMemoryServer(nodeConfig)

    val testCase = for {
      _ <- IO.fromPromise(IO(node.run()))
      wsClientWithReleaseOp <- ouroboros.network
        .SttpJsonWebSocketClient[IO](sttpBackend, uri"ws://$nodeHost:$nodePort")
        .allocated

      (wsClient, wsClientReleaseOp) = wsClientWithReleaseOp

      ouroborosTxSubmissionService <- OuroborosTxSubmissionService[IO, Transaction](
        wsClient,
      ).allocated
        .map { case (service, _) => service }

      // To check the test case we have to close socket on our side as 'node.close()'
      // does not closing socket immediately so we can't verify the case when ws node is not available.
      _ <- wsClientReleaseOp

      dummyTx = Transaction(Header(Hash("hash")), "body")
      _ <- ouroborosTxSubmissionService.submitTransaction(dummyTx)
    } yield ()

    interceptIO[WebSocketClosed](testCase).guarantee(IO.fromPromise(IO(node.close())))
  }
}
