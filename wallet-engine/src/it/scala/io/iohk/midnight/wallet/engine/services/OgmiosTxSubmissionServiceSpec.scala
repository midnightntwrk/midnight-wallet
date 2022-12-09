package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.ContextAwareLog
import io.iohk.midnight.wallet.blockchain.data.Transaction.Header
import io.iohk.midnight.wallet.blockchain.data.{Hash, Transaction}
import io.iohk.midnight.wallet.ogmios
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClientTracer
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService
import io.iohk.midnight.wallet.ogmios.tx_submission.tracing.OgmiosTxSubmissionTracer
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.ws.WebSocketClosed
import typings.midnightMockedNodeApp.anon.PartialConfigany
import typings.midnightMockedNodeApp.configMod.GenesisValue
import typings.midnightMockedNodeApp.mod.InMemoryServer

import scala.scalajs.js.JSConverters.*

class OgmiosTxSubmissionServiceSpec extends CatsEffectSuite {

  test("Submit TX when socket is not available should raise an exception") {
    val nodeHost = "localhost"
    val nodePort = 5205L

    val sttpBackend = FetchCatsBackend[IO]()

    implicit val contextAwareLogTracer: Tracer[IO, ContextAwareLog] =
      Tracer.noOpTracer
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[IO] =
      JsonWebSocketClientTracer.from(contextAwareLogTracer)
    implicit val ogmiosTxSubmissionTracer: OgmiosTxSubmissionTracer[IO] =
      OgmiosTxSubmissionTracer.from(contextAwareLogTracer)

    val nodeConfig =
      PartialConfigany()
        .setGenesis(GenesisValue("value", Seq.empty[Any].toJSArray))
        .setHost(nodeHost)
        .setPort(nodePort.toDouble)

    // Starting up a Node so the 'SttpJsonWebSocketClient' can do a initial connect.
    val node = new InMemoryServer(nodeConfig)

    val testCase = for {
      _ <- IO.fromPromise(IO(node.run()))
      wsClientWithReleaseOp <- ogmios.network
        .SttpJsonWebSocketClient[IO](sttpBackend, uri"ws://$nodeHost:$nodePort")
        .allocated

      (wsClient, wsClientReleaseOp) = wsClientWithReleaseOp

      ogmiosTxSubmissionService <- OgmiosTxSubmissionService(wsClient).allocated
        .map { case (service, _) => service }

      // To check the test case we have to close socket on our side as 'node.close()'
      // does not closing socket immediately so we can't verify the case when ws node is not available.
      _ <- wsClientReleaseOp

      dummyTx = Transaction(Header(Hash("hash")), "body")
      _ <- ogmiosTxSubmissionService.submitTransaction(dummyTx)
    } yield ()

    interceptIO[WebSocketClosed](testCase).guarantee(IO.fromPromise(IO(node.close())))
  }
}
