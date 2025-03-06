package io.iohk.midnight.wallet.integration_tests.prover

import cats.effect.IO
import cats.effect.IO.asyncForIO
import cats.syntax.eq.*
import io.iohk.midnight.testcontainers.buildMod.Wait
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.integration_tests.TestContainers
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.core.Generators
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import munit.{AnyFixture, CatsEffectSuite}

import scala.concurrent.duration.{Duration, DurationInt}
import scala.scalajs.js
import sttp.client3.UriContext
import sttp.model.Uri

trait ProverClientSetup {
  def serverUri(port: Int): Uri = uri"http://localhost:$port"
  val dustToken: TokenType = nativeToken()
  val coinAmount: js.BigInt = js.BigInt(1_000_000)
  val coin: CoinInfo = createCoinInfo(dustToken, coinAmount)
  val spendCoinAmount: js.BigInt = js.BigInt(10_000)
  val spendCoin: CoinInfo = createCoinInfo(dustToken, spendCoinAmount)
  def randomRecipient(): (CoinPublicKey, EncPublicKey) = {
    val secretKeys = Generators.keyGenerator()

    (secretKeys.coinPublicKey, secretKeys.encryptionPublicKey)
  }
  val (cpk, epk) = randomRecipient()
  val output: UnprovenOutput = UnprovenOutput.`new`(spendCoin, cpk, epk)
  val unprovenOffer: UnprovenOffer = UnprovenOffer.fromOutput(output, dustToken, spendCoinAmount)
}

class ProverClientSpec extends CatsEffectSuite with ProverClientSetup {
  override def munitIOTimeout: Duration = 2.minutes

  given ProtocolVersion = ProtocolVersion.V1

  given Tracer[IO, StructuredLog] = new Tracer[IO, StructuredLog] {
    def apply(log: => StructuredLog): IO[Unit] = IO.println(log.message)
  }

  private val proverServerPort = 6300

  private val provingServiceFixture = ResourceSuiteLocalFixture(
    "provingService",
    TestContainers.resource(
      "ghcr.io/midnight-ntwrk/proof-server:3.0.6",
    )(
      _.withExposedPorts(proverServerPort)
        .withWaitStrategy(Wait.forListeningPorts()),
    ),
  )

  override def munitFixtures: Seq[AnyFixture[?]] = List(provingServiceFixture)

  private def withProvingClient(
      body: ProverClient[UnprovenTransaction, Transaction] => IO[Unit],
  ): IO[Unit] = {
    given zswap.NetworkId = zswap.NetworkId.Undeployed
    val port = provingServiceFixture().getMappedPort(proverServerPort).toInt
    ProverClient(serverUri(port)).use(body(_))
  }

  private def withFailingProvingClient(
      body: ProverClient[UnprovenTransaction, Transaction] => IO[Unit],
  ): IO[Unit] = {
    given zswap.NetworkId = zswap.NetworkId.TestNet
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
        assert(transaction.fees(LedgerParameters.dummyParameters()).toScalaBigInt =!= BigInt(0))
      }
    }
  }

  test("Prover should fail to prove invalid transaction") {
    val unprovenTransaction = UnprovenTransaction(unprovenOffer)

    withFailingProvingClient { proverClient =>
      proverClient.proveTransaction(unprovenTransaction).attempt.map { result =>
        assert(result.isLeft)
      }
    }
  }
}
