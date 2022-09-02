package io.iohk.midnight.wallet.engine.services

import cats.effect.IO
import io.iohk.midnight.wallet.blockchain.data.CircuitValues
import io.iohk.midnight.wallet.core.clients.prover.ProverClient
import io.iohk.midnight.wallet.core.services.ProverService
import munit.CatsEffectSuite
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

import scala.concurrent.duration.DurationInt

class ProverServiceIntegrationSpec extends CatsEffectSuite {

  // Default Snarkie server port in midnight-testnet setup is 5101
  private val snarkieServerUri = Uri("localhost:5101")
  // There is by default a 5 seconds delay in the Snarkie Server to generate the proof
  private val maxRetries = 10
  private val retryDelay = 1.seconds

  test("Request proof building and status") {
    new ProverService.Live[IO](
      new ProverClient.Live[IO](
        FetchCatsBackend[IO](),
        snarkieServerUri,
      ),
      maxRetries,
      retryDelay,
      // FIXME: For now I'm asserting length since it's always the same for the mocked responses
    ).prove(CircuitValues(1, 2, 5)).map(p => assertEquals(p.value.length, 2080))
  }
}
