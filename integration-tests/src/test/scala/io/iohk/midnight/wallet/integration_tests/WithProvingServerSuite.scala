package io.iohk.midnight.wallet.integration_tests

import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Test
import sttp.client3.UriContext

import scala.concurrent.duration.DurationInt

trait WithProvingServerSuite
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  override def scalaCheckTestParameters: Test.Parameters =
    super.scalaCheckTestParameters.withMinSuccessfulTests(1)

  private val localProvingServiceFixture = ResourceSuiteLocalFixture(
    "localProvingService",
    ProvingServiceImpl.instance(
      "ghcr.io/midnight-ntwrk/proof-server:3.0.7",
    ),
  )

  private val remoteProvingServiceFixture = ResourceSuiteLocalFixture(
    "remoteProvingService",
    ProvingServiceImpl.remoteInstance(
      uri"https://proof-server-01.proof-pub.stg.midnight.tools",
    ),
  )

  override def munitIOTimeout = 10.minutes

  override def munitFixtures = List(localProvingServiceFixture)

  given provingService: ProvingService[UnprovenTransaction, Transaction] =
    localProvingServiceFixture()

  lazy val remoteProvingService: ProvingService[UnprovenTransaction, Transaction] =
    remoteProvingServiceFixture()
}
