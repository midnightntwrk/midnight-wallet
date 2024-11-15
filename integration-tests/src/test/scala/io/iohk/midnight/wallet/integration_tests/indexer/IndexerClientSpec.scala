package io.iohk.midnight.wallet.integration_tests.indexer

import cats.effect.IO
import cats.effect.IO.asyncForIO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.indexer.IndexerClient
import munit.CatsEffectSuite
import sttp.client3.UriContext

class IndexerClientSpec extends CatsEffectSuite {
  private def withIndexerClient(body: IndexerClient => IO[Unit]): IO[Unit] = {
    given Tracer[IO, StructuredLog] = Tracer.noOpTracer
    IndexerClient(uri"ws://localhost:8088/api/v1/graphql/ws").use(body(_))
  }

  // PubSub new version doesn't come with fake data source,
  // thus the only way to run an integration test is to run a real node.
  // The SubstrateClientSpec test itself is ignored, so this test can't be enabled either,
  // until a good way to run a pair PubSub-Node locally for these tests is found.
  test("Indexer client must expose a stream with raw transactions".ignore) {
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
