package io.iohk.midnight.wallet

import cats.MonadThrow
import cats.effect.std.Random
import cats.effect.{Clock, SyncIO}
import cats.syntax.applicative.*
import io.iohk.midnight.wallet.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.clients.prover.*
import io.iohk.midnight.wallet.domain.Generators.*
import io.iohk.midnight.wallet.domain.{Block, SemanticEvent, UserId}
import io.iohk.midnight.wallet.services.*
import io.iohk.midnight.wallet.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

trait WalletSpec {
  val proverClient = new ProverClientStub()
  val failingProverClient = new FailingProverClient()
  val alwaysInProgressProverClient = new AlwaysInProgressProverClient()
  val syncService = new SyncServiceStub()
  val failingSyncService = new FailingSyncService()

  def buildWallet[F[_]: MonadThrow: Clock: Random](
      proverClient: ProverClient[F],
      syncService: SyncService[F],
      userId: UserId = UserId("test_user"),
  ): Wallet[F] =
    new Wallet.Live[F](
      new ProverService.Live[F](proverClient, 2),
      syncService,
      (_: Block) => Seq.empty[SemanticEvent].pure[F],
      userId,
    )

  implicit val random: Random[SyncIO] = Random.scalaUtilRandom[SyncIO].unsafeRunSync()
  val wallet = buildWallet[SyncIO](proverClient, syncService)

  val ExpectedHashLength = 64
  def isHexString(str: String): Boolean =
    str.forall((('0' to '9') ++ ('a' to 'f')).contains(_))
}

class WalletCallContractSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletSpec
    with BetterOutputSuite {

  test("a hash is returned") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      wallet.callContract(input).map { r =>
        assertEquals(r.value.length, ExpectedHashLength)
        assert(isHexString(r.value))
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(callContractInputGen, callContractInputGen) {
      (input1: CallContractInput, input2: CallContractInput) =>
        for {
          hash1 <- wallet.callContract(input1)
          hash2 <- wallet.callContract(input2)
          wasSubmitted1 = syncService.wasCallTxSubmitted(hash1)
          wasSubmitted2 = syncService.wasCallTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when prover client fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(failingProverClient, syncService)

      wallet
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingProverClient.TheError)))
    }
  }

  test("does not retry proof status forever") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(alwaysInProgressProverClient, syncService)

      wallet
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(ProverService.Error.PollingForProofMaxRetriesReached)))
    }
  }

  test("fails when platform submission fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(proverClient, failingSyncService)

      wallet
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingSyncService.SyncServiceError)))
    }
  }
}

class WalletDeployContractSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletSpec
    with BetterOutputSuite {
  test("a hash is returned") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      wallet.deployContract(input).map { r =>
        assertEquals(r.value.length, ExpectedHashLength)
        assert(isHexString(r.value))
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(deployContractInputGen, deployContractInputGen) {
      (input1: DeployContractInput, input2: DeployContractInput) =>
        for {
          hash1 <- wallet.deployContract(input1)
          hash2 <- wallet.deployContract(input2)
          wasSubmitted1 = syncService.wasDeployTxSubmitted(hash1)
          wasSubmitted2 = syncService.wasDeployTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when platform submission fails") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      val wallet = buildWallet(proverClient, failingSyncService)

      wallet
        .deployContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingSyncService.SyncServiceError)))
    }
  }
}

class WalletUserIdSpec extends CatsEffectSuite with WalletSpec with BetterOutputSuite {
  test("generate a UserId and keep it in memory") {
    val wallet = buildWallet(proverClient, syncService)
    for {
      id1 <- wallet.getUserId()
      id2 <- wallet.getUserId()
    } yield assertEquals(id1, id2)
  }
}
