package io.iohk.midnight.wallet.core.services

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.testcontainers.buildMod.{GenericContainer, Wait}
import io.iohk.midnight.testcontainers.buildUtilsPortMod.PortWithBinding
import io.iohk.midnight.wallet.core.util.TestContainers
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap.*
import sttp.client3.UriContext

object ProvingServiceImpl {
  private def testProverServerContainerConfig(container: GenericContainer): GenericContainer =
    container
      .withExposedPorts(PortWithBinding(6300, 6300))
      .withWaitStrategy(Wait.forListeningPorts())

  def instance(dockerImage: String): Resource[IO, ProvingService[IO]] =
    TestContainers.resource(dockerImage)(testProverServerContainerConfig) >>
      ProverClient[IO](uri"http://localhost:6300").map { client =>
        new ProvingService[IO] {
          override def proveTransaction(tx: UnprovenTransaction): IO[Transaction] =
            client.proveTransaction(tx)
          override def proveOffer(offer: UnprovenOffer): IO[Offer] =
            client.proveOffer(offer)
        }
      }
}
