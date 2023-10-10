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
      "registry.ci.iog.io/proof-server@sha256:0790c3b85abeaa681799d782e565bf5c0839354124de128e2722c1ccb997d0f6",
    ),
  )

  override def munitIOTimeout = 10.minutes

  override def munitFixtures = List(provingServiceFixture)

  given provingService: ProvingService[IO] = provingServiceFixture()
}
