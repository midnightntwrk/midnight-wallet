package io.iohk.midnight.wallet.integration_tests

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.testcontainers.buildMod.{GenericContainer, Wait}
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap.NetworkId
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.testcontainers.buildTypesMod.Environment
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import sttp.client3.UriContext
import sttp.model.Uri
import io.iohk.midnight.node.osMod

import scala.scalajs.js

object ProvingServiceImpl {
  private val provingServicePort = 6300
  given NetworkId = NetworkId.Undeployed
  given ProtocolVersion = ProtocolVersion.V1
  given Tracer[IO, StructuredLog] = new Tracer[IO, StructuredLog] {
    def apply(log: => StructuredLog): IO[Unit] = IO.println(log.message)
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def testProverServerContainerConfig(container: GenericContainer): GenericContainer =
    container
      .withExposedPorts(provingServicePort)
      .withWaitStrategy(Wait.forListeningPorts())
      .withEnvironment(new js.Object {
        val RAYON_NUM_THREADS = osMod.availableParallelism().min(32).toString
      }.asInstanceOf[Environment])

  def instance(
      dockerImage: String,
  ): Resource[IO, ProvingService[UnprovenTransaction, Transaction]] =
    TestContainers.resource(dockerImage)(testProverServerContainerConfig).flatMap { container =>
      val port = container.getMappedPort(provingServicePort).toInt
      ProverClient[UnprovenTransaction, Transaction](uri"http://localhost:$port")
        .map(client => client.proveTransaction)
    }

  def remoteInstance(url: Uri): Resource[IO, ProvingService[UnprovenTransaction, Transaction]] = {
    ProverClient[UnprovenTransaction, Transaction](url)
      .map(client => client.proveTransaction)
  }
}
