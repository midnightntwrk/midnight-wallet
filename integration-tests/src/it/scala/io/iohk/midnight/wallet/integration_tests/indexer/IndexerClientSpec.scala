package io.iohk.midnight.wallet.integration_tests.indexer

import cats.effect.IO
import cats.effect.IO.asyncForIO
import io.iohk.midnight.testcontainers.buildMod.Wait
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.integration_tests.TestContainers
import munit.{AnyFixture, CatsEffectSuite}
import scala.concurrent.duration.{Duration, DurationInt}
import sttp.client3.UriContext
import sttp.model.Uri

class IndexerClientSpec extends CatsEffectSuite {
  override def munitIOTimeout: Duration = 3.minutes
  private val pubSubIndexerPort = 8088

  private val pubSubIndexerServiceFixture = ResourceSuiteLocalFixture(
    "pubSubIndexerService",
    TestContainers.resource(
      "ghcr.io/midnight-ntwrk/midnight-pubsub-indexer:0.2.14",
    )(
      _.withExposedPorts(pubSubIndexerPort)
        .withWaitStrategy(Wait.forListeningPorts()),
    ),
  )

  override def munitFixtures: Seq[AnyFixture[_]] = List(pubSubIndexerServiceFixture)

  private def indexerUri(port: Int): Uri = uri"http://localhost:$port/api/graphql"
  private def indexerWsUri(port: Int): Uri = uri"ws://localhost:$port/api/graphql/ws"

  private def withIndexerClient(body: IndexerClient[IO] => IO[Unit]): IO[Unit] = {
    val mappedPort = pubSubIndexerServiceFixture().getMappedPort(pubSubIndexerPort).toInt
    given Tracer[IO, StructuredLog] = Tracer.noOpTracer
    IndexerClient(
      indexerUri(mappedPort),
      indexerWsUri(mappedPort),
    ).use(body(_))
  }

  test("Indexer client must expose a stream with raw transactions") {
    withIndexerClient { indexerClient =>
      indexerClient
        .viewingUpdates("2045b931b0bd3d4b7d2e9e3b5a28361fc0b7d6d9f633a912f56fe3d7040d645d05", None)
        .take(5)
        .compile
        .toList
        .map(updates => assert(updates.nonEmpty))
    }
  }
}
