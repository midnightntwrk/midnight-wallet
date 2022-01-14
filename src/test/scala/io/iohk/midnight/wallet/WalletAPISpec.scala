package io.iohk.midnight.wallet

import cats.effect.{Clock, SyncIO}
import cats.MonadThrow
import io.iohk.midnight.wallet.api.WalletAPI
import io.iohk.midnight.wallet.circuit.{CircuitValuesExtractor, CircuitValuesExtractorStub}
import io.iohk.midnight.wallet.clients.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Generators.*
import io.iohk.midnight.wallet.services.ProverService
import io.iohk.midnight.wallet.store.{InMemoryPrivateStateStore, PrivateStateStore}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Prop.propBoolean
import org.scalacheck.Properties
import org.scalacheck.effect.PropF.forAllF
import scala.util.Try

trait WalletAPISpec:
  val privateStateStore = InMemoryPrivateStateStore()
  val circuitValuesExtractor = CircuitValuesExtractorStub()
  val proverClient = ProverClientStub()
  val failingProverClient = FailingProverClient()
  val alwaysInProgressProverClient = AlwaysInProgressProverClient()
  val platformClient = PlatformClientStub()

  def buildWalletApi[F[_]: MonadThrow: Clock](
      privateStateStore: PrivateStateStore[F],
      circuitValuesExtractor: CircuitValuesExtractor,
      proverClient: ProverClient[F],
      platformClient: PlatformClient[F],
  ): WalletAPI[F] =
    WalletAPI.Live[F](
      privateStateStore,
      circuitValuesExtractor,
      ProverService.Live[F](proverClient, 2),
      platformClient,
    )

  val walletApi = buildWalletApi[SyncIO](
    privateStateStore,
    circuitValuesExtractor,
    proverClient,
    platformClient,
  )

class WalletAPICallContractSpec extends CatsEffectSuite, ScalaCheckEffectSuite, WalletAPISpec:
  test("a hash is returned") {
    forAllF(contractInputGen) { (input: ContractInput) =>
      walletApi.callContract(input).map(r => assert(r.isInstanceOf[Hash]))
    }
  }

  test("private state is updated") {
    forAllF(contractInputGen) { (input: ContractInput) =>
      for
        _ <- walletApi.callContract(input)
        maybeState <- privateStateStore.getState(input.contractId)
      yield assert(maybeState.contains(input.contractState.privateState))
    }
  }

  test("private state is separated") {
    forAllF(contractInputGen, contractInputGen) { (input1: ContractInput, input2: ContractInput) =>
      for
        _ <- walletApi.callContract(input1)
        _ <- walletApi.callContract(input2)
        state1 <- privateStateStore.getState(input1.contractId)
        state2 <- privateStateStore.getState(input2.contractId)
      yield assert(state1 != state2)
    }
  }

  test("fails when prover client fails") {
    forAllF(contractInputGen) { (input: ContractInput) =>
      val walletApi = buildWalletApi(
        privateStateStore,
        circuitValuesExtractor,
        failingProverClient,
        platformClient,
      )

      walletApi
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingProverClient.TheError)))
    }
  }

  test("does not retry proof status forever") {
    forAllF(contractInputGen) { (input: ContractInput) =>
      val walletApi = buildWalletApi(
        privateStateStore,
        circuitValuesExtractor,
        alwaysInProgressProverClient,
        platformClient,
      )

      walletApi
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(ProverService.Error.PollingForProofMaxRetriesReached)))
    }
  }

class WalletAPIGetPrivateStateSpec extends CatsEffectSuite, ScalaCheckEffectSuite, WalletAPISpec:
  test("initial state is empty") {
    forAllF(contractIdGen) { (contractId: ContractId) =>
      walletApi.getPrivateState(contractId).map(maybeState => assert(maybeState.isEmpty))
    }
  }

  test("state is updated") {
    forAllF(contractIdGen) { (contractId: ContractId) =>
      val contractState = ContractPrivateState()
      for
        _ <- privateStateStore.setState(contractId, contractState)
        maybeState <- walletApi.getPrivateState(contractId)
      yield assert(maybeState.contains(contractState))
    }
  }
