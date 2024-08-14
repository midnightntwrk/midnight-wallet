package io.iohk.midnight.wallet.integration_tests.prover

import cats.effect.IO
import cats.effect.IO.asyncForIO
import cats.syntax.eq.*
import io.iohk.midnight.testcontainers.buildMod.Wait
import io.iohk.midnight.wallet.integration_tests.TestContainers
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap.*
import munit.{AnyFixture, CatsEffectSuite}
import scala.concurrent.duration.{Duration, DurationInt}
import scala.scalajs.js
import sttp.client3.UriContext
import sttp.model.Uri

trait ProverClientSetup {
  def serverUri(port: Int): Uri = uri"http://localhost:$port"
  val dustToken: TokenType = TokenType.Native
  val coinAmount: BigInt = BigInt(1_000_000)
  val coin: CoinInfo = CoinInfo(dustToken, coinAmount)
  val spendCoinAmount: BigInt = BigInt(10_000)
  val spendCoin: CoinInfo = CoinInfo(dustToken, spendCoinAmount)
  def randomRecipient(): (CoinPublicKey, EncryptionPublicKey) = {
    val state = LocalState()
    (state.coinPublicKey, state.encryptionPublicKey)
  }
  val (cpk, epk) = randomRecipient()
  val output: UnprovenOutput = UnprovenOutput(spendCoin, cpk, epk)
  val unprovenOffer: UnprovenOffer = UnprovenOffer.fromOutput(output, dustToken, spendCoinAmount)
}

class ProverClientSpec extends CatsEffectSuite with ProverClientSetup {
  override def munitIOTimeout: Duration = 2.minutes

  private val proverServerPort = 6300

  private val provingServiceFixture = ResourceSuiteLocalFixture(
    "provingService",
    TestContainers.resource(
      "ghcr.io/midnight-ntwrk/proof-server:3.0.0-beta.2",
    )(
      _.withExposedPorts(proverServerPort)
        .withWaitStrategy(Wait.forListeningPorts()),
    ),
  )

  override def munitFixtures: Seq[AnyFixture[?]] = List(provingServiceFixture)

  private def withProvingClient(body: ProverClient[IO] => IO[Unit]): IO[Unit] = {
    val port = provingServiceFixture().getMappedPort(proverServerPort).toInt
    ProverClient(serverUri(port)).use(body(_))
  }

  test("Prover client must prove transaction") {
    val unprovenTransaction = UnprovenTransaction(unprovenOffer)

    withProvingClient { proverClient =>
      proverClient.proveTransaction(unprovenTransaction).map { transaction =>
        val imbalances = transaction.imbalances(true)
        assert(imbalances.size === 1)
        assert(imbalances.get(dustToken).contains(-spendCoinAmount))
        assert(transaction.fees =!= BigInt(0))
      }
    }
  }
}
