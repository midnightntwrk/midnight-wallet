package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.effect.std.Random
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.Block.Height.Genesis
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash}
import io.iohk.midnight.wallet.core.Wallet.{
  CallContractInput,
  DeployContractInput,
  TransactionRejected,
}
import io.iohk.midnight.wallet.core.clients.prover.*
import io.iohk.midnight.wallet.core.domain.Generators.{callContractInputGen, deployContractInputGen}
import io.iohk.midnight.wallet.core.domain.UserId
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

import java.time.Instant
import scala.concurrent.duration.DurationInt

trait WalletSpec {
  val proverClient = new ProverClientStub()
  val failingProverClient = new FailingProverClient()
  val alwaysInProgressProverClient = new AlwaysInProgressProverClient()
  val txSubmissionService = new TxSubmissionServiceStub()
  val failingTxSubmissionService = new FailingTxSubmissionServiceStub()
  val syncService = new SyncServiceStub()
  val failingSyncService = new FailingSyncServiceStub()

  def buildWallet(
      proverClient: ProverClient[IO],
      txSubmissionService: TxSubmissionService[IO],
      syncService: SyncService[IO],
      userId: UserId = UserId("test_user"),
  ): IO[Wallet[IO]] =
    Random.scalaUtilRandom[IO].map { implicit random =>
      new Wallet.Live[IO](
        new ProverService.Live[IO](proverClient, maxRetries = 1, retryDelay = 10.millis),
        txSubmissionService,
        syncService,
        userId,
      )
    }

  val walletIO = buildWallet(proverClient, txSubmissionService, syncService)

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
      walletIO.flatMap(_.callContract(input)).map { r =>
        assertEquals(r.value.length, ExpectedHashLength)
        assert(isHexString(r.value))
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(callContractInputGen, callContractInputGen) {
      (input1: CallContractInput, input2: CallContractInput) =>
        for {
          wallet <- walletIO
          hash1 <- wallet.callContract(input1)
          hash2 <- wallet.callContract(input2)
          wasSubmitted1 = txSubmissionService.wasCallTxSubmitted(hash1)
          wasSubmitted2 = txSubmissionService.wasCallTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when prover client fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(failingProverClient, txSubmissionService, syncService)

      wallet
        .flatMap(_.callContract(input))
        .attempt
        .map(assertEquals(_, Left(FailingProverClient.TheError)))
    }
  }

  test("does not retry proof status forever") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(alwaysInProgressProverClient, txSubmissionService, syncService)

      wallet
        .flatMap(_.callContract(input))
        .attempt
        .map(assertEquals(_, Left(ProverService.Error.PollingForProofMaxRetriesReached)))
    }
  }

  test("fails when platform submission fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(proverClient, failingTxSubmissionService, syncService)

      wallet
        .flatMap(_.callContract(input))
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("fails when platform submission got rejected") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(proverClient, new RejectedTxSubmissionServiceStub(), syncService)

      wallet
        .flatMap(_.callContract(input))
        .attempt
        .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
    }
  }

  test("sync gives empty stream") {
    // For this test case we need to feed sync service with at least one block to test this case.
    val singleBlockSyncService = new SyncServiceStub(
      blocks = Seq(
        Block(
          header = Block.Header(
            hash = Hash("some-hash"),
            parentHash = Hash("some-hash"),
            height = Genesis,
            timestamp = Instant.now(),
          ),
          transactions = Seq.empty,
        ),
      ),
    )

    buildWallet(proverClient, txSubmissionService, singleBlockSyncService)
      .flatMap(_.sync().compile.to(List))
      .attempt
      .map {
        case Left(error) => fail("failed", error)
        case Right(syncResult) =>
          assert(syncResult.length === 1)
          assert(syncResult.contains(Seq.empty))
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
      walletIO.flatMap(_.deployContract(input)).map { r =>
        assertEquals(r.value.length, ExpectedHashLength)
        assert(isHexString(r.value))
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(deployContractInputGen, deployContractInputGen) {
      (input1: DeployContractInput, input2: DeployContractInput) =>
        for {
          wallet <- walletIO
          hash1 <- wallet.deployContract(input1)
          hash2 <- wallet.deployContract(input2)
          wasSubmitted1 = txSubmissionService.wasDeployTxSubmitted(hash1)
          wasSubmitted2 = txSubmissionService.wasDeployTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when platform submission fails") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      buildWallet(proverClient, failingTxSubmissionService, syncService)
        .flatMap(_.deployContract(input))
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("fails when platform submission got rejected") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      buildWallet(proverClient, new RejectedTxSubmissionServiceStub(), syncService)
        .flatMap(_.deployContract(input))
        .attempt
        .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
    }
  }

}

class WalletUserIdSpec extends CatsEffectSuite with WalletSpec with BetterOutputSuite {
  test("generate a UserId and keep it in memory") {
    for {
      wallet <- buildWallet(proverClient, txSubmissionService, syncService)
      id1 <- wallet.getUserId()
      id2 <- wallet.getUserId()
    } yield assertEquals(id1, id2)
  }
}
