package io.iohk.midnight.wallet.indexer

import cats.effect.IO
import cats.effect.IO.asyncForIO
import io.iohk.midnight.testcontainers.buildMod.Wait
import io.iohk.midnight.testcontainers.buildUtilsPortMod.PortWithBinding
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
      "ghcr.io/input-output-hk/midnight-pubsub-indexer:556b2bf03cf9d353a9631b8f76510b9cf5b727ac",
    )(
      _.withExposedPorts(PortWithBinding(pubSubIndexerPort, pubSubIndexerPort))
        .withWaitStrategy(Wait.forListeningPorts()),
    ),
  )

  override def munitFixtures: Seq[AnyFixture[_]] = List(pubSubIndexerServiceFixture)

  private val indexerUri: Uri = uri"http://localhost:$pubSubIndexerPort/api/graphql"
  private val indexerWsUri: Uri = uri"ws://localhost:$pubSubIndexerPort/api/graphql/ws"

  private def withIndexerClient(body: IndexerClient[IO] => IO[Unit]): IO[Unit] =
    IndexerClient(indexerUri, indexerWsUri).use(body(_))

  test("Indexer client must expose a stream with raw transactions") {
    withIndexerClient { indexerClient =>
      indexerClient
        .rawTransactions("2045b931b0bd3d4b7d2e9e3b5a28361fc0b7d6d9f633a912f56fe3d7040d645d05")
        .take(5)
        .compile
        .toList
        .map { transactions => assert(transactions.nonEmpty) }
    }
  }
}
