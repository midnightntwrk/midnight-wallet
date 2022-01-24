package io.iohk.midnight.wallet

import cats.effect.{Clock, SyncIO}
import cats.MonadThrow
import io.iohk.midnight.wallet.api.WalletAPI
import io.iohk.midnight.wallet.api.WalletAPI.*
import io.iohk.midnight.wallet.clients.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Generators.*
import io.iohk.midnight.wallet.services.ProverService
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Prop.propBoolean
import org.scalacheck.Properties
import org.scalacheck.effect.PropF.forAllF
import scala.util.Try

trait WalletAPISpec:
  val proverClient = ProverClientStub()
  val failingProverClient = FailingProverClient()
  val alwaysInProgressProverClient = AlwaysInProgressProverClient()
  val platformClient = PlatformClientStub()
  val failingPlatformClient = FailingPlatformClient()

  def buildWalletApi[F[_]: MonadThrow: Clock](
      proverClient: ProverClient[F],
      platformClient: PlatformClient[F],
  ): WalletAPI[F] =
    WalletAPI.Live[F](
      ProverService.Live[F](proverClient, 2),
      platformClient,
    )

  val walletApi = buildWalletApi[SyncIO](proverClient, platformClient)

class WalletAPICallContractSpec extends CatsEffectSuite, ScalaCheckEffectSuite, WalletAPISpec:
  test("a hash is returned") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      walletApi.callContract(input).map(r => assert(r.isInstanceOf[CallTransaction.Hash]))
    }
  }

  test("transactions get submitted to the client") {
    forAllF(callContractInputGen, callContractInputGen) {
      (input1: CallContractInput, input2: CallContractInput) =>
        for
          hash1 <- walletApi.callContract(input1)
          hash2 <- walletApi.callContract(input2)
          wasSubmitted1 = platformClient.wasCallTxSubmitted(hash1)
          wasSubmitted2 = platformClient.wasCallTxSubmitted(hash2)
        yield assert(wasSubmitted1 && wasSubmitted2)
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

class WalletAPIDeployContractSpec extends CatsEffectSuite, ScalaCheckEffectSuite, WalletAPISpec:
  test("a hash is returned") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      walletApi.deployContract(input).map(r => assert(r.isInstanceOf[DeployTransaction.Hash]))
    }
  }

  test("transactions get submitted to the client") {
    forAllF(deployContractInputGen, deployContractInputGen) {
      (input1: DeployContractInput, input2: DeployContractInput) =>
        for
          hash1 <- walletApi.deployContract(input1)
          hash2 <- walletApi.deployContract(input2)
          wasSubmitted1 = platformClient.wasDeployTxSubmitted(hash1)
          wasSubmitted2 = platformClient.wasDeployTxSubmitted(hash2)
        yield assert(wasSubmitted1 && wasSubmitted2)
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
