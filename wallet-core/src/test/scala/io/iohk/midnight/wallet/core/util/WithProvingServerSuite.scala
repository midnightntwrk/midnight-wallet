package io.iohk.midnight.wallet.core.util

import cats.effect.IO
import io.iohk.midnight.wallet.core.services.{ProvingService, ProvingServiceImpl}
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
    ProvingServiceImpl.instance("registry.ci.iog.io/proof-server:master"),
  )

  override def munitIOTimeout = 10.minutes

  override def munitFixtures = List(provingServiceFixture)

  given provingService: ProvingService[IO] = provingServiceFixture()
}
