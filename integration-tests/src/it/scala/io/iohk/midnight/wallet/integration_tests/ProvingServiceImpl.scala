package io.iohk.midnight.wallet.integration_tests

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.testcontainers.buildMod.{GenericContainer, Wait}
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap.*
import sttp.client3.UriContext

object ProvingServiceImpl {
  private val provingServicePort = 6300

  private def testProverServerContainerConfig(container: GenericContainer): GenericContainer =
    container
      .withExposedPorts(provingServicePort)
      .withWaitStrategy(Wait.forListeningPorts())

  def instance(dockerImage: String): Resource[IO, ProvingService[IO]] =
    TestContainers.resource(dockerImage)(testProverServerContainerConfig).flatMap { container =>
      val port = container.getMappedPort(provingServicePort).toInt
      ProverClient[IO](uri"http://localhost:$port").map { client =>
        new ProvingService[IO] {
          override def proveTransaction(tx: UnprovenTransaction): IO[Transaction] =
            client.proveTransaction(tx)
          override def proveOffer(offer: UnprovenOffer): IO[Offer] =
            client.proveOffer(offer)
        }
      }
    }
}
