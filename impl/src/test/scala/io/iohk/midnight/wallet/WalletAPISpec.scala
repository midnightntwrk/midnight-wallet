package io.iohk.midnight.wallet

import cats.MonadThrow
import cats.effect.std.Random
import cats.effect.{Clock, SyncIO}
import io.iohk.midnight.wallet.api.WalletAPI
import io.iohk.midnight.wallet.api.WalletAPI.*
import io.iohk.midnight.wallet.clients.platform.*
import io.iohk.midnight.wallet.clients.prover.*
import io.iohk.midnight.wallet.domain.Generators.*
import io.iohk.midnight.wallet.services.{PlatformService, ProverService}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

trait WalletAPISpec {
  val proverClient = new ProverClientStub()
  val failingProverClient = new FailingProverClient()
  val alwaysInProgressProverClient = new AlwaysInProgressProverClient()
  val platformClient = new PlatformClientStub()
  val failingPlatformClient = new FailingPlatformClient()

  def buildWalletApi[F[_]: MonadThrow: Clock: Random](
      proverClient: ProverClient[F],
      platformClient: PlatformClient[F],
  ): WalletAPI[F] =
    new WalletAPI.Live[F](
      new ProverService.Live[F](proverClient, 2),
      new PlatformService.Live[F](platformClient),
    )

  implicit val random: Random[SyncIO] = Random.scalaUtilRandom[SyncIO].unsafeRunSync()
  val walletApi = buildWalletApi[SyncIO](proverClient, platformClient)

  val ExpectedHashLength = 64
  def isHexString(str: String): Boolean =
    str.forall((('0' to '9') ++ ('a' to 'f')).contains(_))
}

@SuppressWarnings(Array("org.wartremover.warts.Any"))
class WalletAPICallContractSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletAPISpec {
  test("a hash is returned") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      walletApi.callContract(input).map { r =>
        assertEquals(r.value.length, ExpectedHashLength)
        assert(isHexString(r.value))
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(callContractInputGen, callContractInputGen) {
      (input1: CallContractInput, input2: CallContractInput) =>
        for {
          hash1 <- walletApi.callContract(input1)
          hash2 <- walletApi.callContract(input2)
          wasSubmitted1 = platformClient.wasCallTxSubmitted(hash1)
          wasSubmitted2 = platformClient.wasCallTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when prover client fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val walletApi = buildWalletApi(failingProverClient, platformClient)

      walletApi
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingProverClient.TheError)))
    }
  }

  test("does not retry proof status forever") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val walletApi = buildWalletApi(alwaysInProgressProverClient, platformClient)

      walletApi
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(ProverService.Error.PollingForProofMaxRetriesReached)))
    }
  }

  test("fails when platform submission fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val walletApi = buildWalletApi(proverClient, failingPlatformClient)

      walletApi
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingPlatformClient.PlatformClientError)))
    }
  }
}

@SuppressWarnings(Array("org.wartremover.warts.Any"))
class WalletAPIDeployContractSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletAPISpec {
  test("a hash is returned") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      walletApi.deployContract(input).map { r =>
        assertEquals(r.value.length, ExpectedHashLength)
        assert(isHexString(r.value))
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(deployContractInputGen, deployContractInputGen) {
      (input1: DeployContractInput, input2: DeployContractInput) =>
        for {
          hash1 <- walletApi.deployContract(input1)
          hash2 <- walletApi.deployContract(input2)
          wasSubmitted1 = platformClient.wasDeployTxSubmitted(hash1)
          wasSubmitted2 = platformClient.wasDeployTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when platform submission fails") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      val walletApi = buildWalletApi(proverClient, failingPlatformClient)

      walletApi
        .deployContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingPlatformClient.PlatformClientError)))
    }
  }
}
