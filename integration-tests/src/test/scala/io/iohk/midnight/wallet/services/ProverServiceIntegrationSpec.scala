package io.iohk.midnight.wallet.services

import cats.effect.IO
import io.iohk.midnight.wallet.clients.prover.ProverClient
import io.iohk.midnight.wallet.domain.CircuitValues
import munit.CatsEffectSuite
import scala.concurrent.duration.DurationInt
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

class ProverServiceIntegrationSpec extends CatsEffectSuite {

  // Default Snarkie server port in midnight-testnet setup is 5101
  val snarkieServerUri = Uri("localhost:5101")
  // There is by default a 5 seconds delay in the Snarkie Server to generate the proof
  val maxRetries = 10
  val retryDelay = 1.seconds
  val timeout = 10.seconds

  test("Request proof building and status") {
    new ProverService.Live[IO](
      new ProverClient.Live[IO](
        FetchCatsBackend[IO](),
        snarkieServerUri,
      ),
      maxRetries,
      retryDelay,
      // FIXME: For now I'm asserting length since it's always the same for the mocked responses
    ).prove(CircuitValues(1, 2, 5)).map(p => assert(p.value.length == 2080))
  }
}
