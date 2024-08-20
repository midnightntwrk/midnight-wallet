package io.iohk.midnight.wallet.integration_tests

import cats.effect.IO
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Test
import scala.concurrent.duration.DurationInt

trait WithProvingServerSuite
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  override def scalaCheckTestParameters: Test.Parameters =
    super.scalaCheckTestParameters.withMinSuccessfulTests(1)

  private val provingServiceFixture = ResourceSuiteLocalFixture(
    "provingService",
    ProvingServiceImpl.instance(
      "ghcr.io/midnight-ntwrk/proof-server:3.0.0",
    ),
  )

  override def munitIOTimeout = 10.minutes

  override def munitFixtures = List(provingServiceFixture)

  given provingService: ProvingService[IO] = provingServiceFixture()
}
