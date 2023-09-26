package io.iohk.midnight.wallet.prover

import cats.effect.IO
import cats.effect.IO.asyncForIO
import cats.syntax.eq.*
import io.iohk.midnight.js.interop.cats.Instances.jsBigIntEq
import io.iohk.midnight.midnightZswap.mod.*
import io.iohk.midnight.testcontainers.buildMod.Wait
import io.iohk.midnight.testcontainers.buildUtilsPortMod.PortWithBinding
import munit.{AnyFixture, CatsEffectSuite}
import scala.scalajs.js
import sttp.client3.UriContext
import sttp.model.Uri

trait ProverClientSetup {
  val serverUri: Uri = uri"http://localhost:6300"
  val dustToken: String = nativeToken()
  val coinAmount: js.BigInt = js.BigInt(1_000_000)
  val coin: CoinInfo = createCoinInfo(dustToken, coinAmount)
  val spendCoinAmount: js.BigInt = js.BigInt(10_000)
  val spendCoin: CoinInfo = createCoinInfo(dustToken, spendCoinAmount)
  def randomRecipient(): (CoinPublicKey, EncPublicKey) = {
    val state = new LocalState()
    (state.coinPublicKey, state.encryptionPublicKey)
  }
  val (cpk, epk) = randomRecipient()
  val output: UnprovenOutput = UnprovenOutput.`new`(spendCoin, cpk, epk)
  val unprovenOffer: UnprovenOffer = UnprovenOffer.fromOutput(output, dustToken, spendCoinAmount)

  def withProvingClient(
      body: ProverClient[IO] => IO[Unit],
  ): IO[Unit] =
    ProverClient(serverUri)
      .use(body(_))
}

class ProverClientSpec extends CatsEffectSuite with ProverClientSetup {
  private val provingServiceFixture = ResourceSuiteLocalFixture(
    "provingService",
    TestContainers.resource("registry.ci.iog.io/proof-server:master")(
      _.withExposedPorts(PortWithBinding(6300, 6300))
        .withWaitStrategy(Wait.forListeningPorts()),
    ),
  )

  override def munitFixtures: Seq[AnyFixture[_]] = List(provingServiceFixture)

  test("Prover client must prove offer") {
    withProvingClient { proverClient =>
      proverClient.proveOffer(unprovenOffer).map { offer =>
        assert(offer.outputs.length == 1)
        assert(offer.inputs.isEmpty)
        assert(offer.deltas.get(dustToken).contains(-spendCoinAmount))
      }
    }
  }

  test("Prover client must prove transaction") {
    val unprovenTransaction = new UnprovenTransaction(unprovenOffer)

    withProvingClient { proverClient =>
      proverClient.proveTransaction(unprovenTransaction).map { transaction =>
        val imbalances = transaction.imbalances(true)
        assert(imbalances.size == 1)
        assert(imbalances.get(dustToken).contains(-spendCoinAmount))
        assert(transaction.fees() =!= js.BigInt(0))
      }
    }
  }
}
