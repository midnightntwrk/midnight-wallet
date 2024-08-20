package io.iohk.midnight.wallet.integration_tests

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.testcontainers.buildMod.{GenericContainer, Wait}
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap.NetworkId
import sttp.client3.UriContext

object ProvingServiceImpl {
  private val provingServicePort = 6300
  given NetworkId = NetworkId.Undeployed
  given ProtocolVersion = ProtocolVersion.V1

  private def testProverServerContainerConfig(container: GenericContainer): GenericContainer =
    container
      .withExposedPorts(provingServicePort)
      .withWaitStrategy(Wait.forListeningPorts())

  def instance(dockerImage: String): Resource[IO, ProvingService[IO]] =
    TestContainers.resource(dockerImage)(testProverServerContainerConfig).flatMap { container =>
      val port = container.getMappedPort(provingServicePort).toInt
      ProverClient[IO](uri"http://localhost:$port")
        .map(client => client.proveTransaction)
    }
}
