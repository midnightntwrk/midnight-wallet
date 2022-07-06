package io.iohk.midnight.wallet

import cats.effect.IO
import cats.effect.std.Random
import cats.syntax.all.*
import io.iohk.midnight.wallet.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.clients.prover.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Generators.*
import io.iohk.midnight.wallet.domain.services.SyncService
import io.iohk.midnight.wallet.services.*
import io.iohk.midnight.wallet.util.BetterOutputSuite
import io.iohk.midnight.wallet.util.implicits.Equality.*
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF

import scala.concurrent.duration.DurationInt
import io.iohk.midnight.wallet.domain.services.TxSubmissionService

trait WalletSpec {
  val proverClient = new ProverClientStub()
  val failingProverClient = new FailingProverClient()
  val alwaysInProgressProverClient = new AlwaysInProgressProverClient()
  val txSubmissionService = new TxSubmissionServiceStub()
  val failingTxSubmissionService = new FailingTxSubmissionServiceStub()
  val syncService = new SyncServiceStub()
  val failingSyncService = new FailingSyncServiceStub()
  val emptyLaresService: LaresService[IO] =
    (_: Block) => (Seq.empty[SemanticEvent], Seq.empty[TransactionRequest]).pure[IO]

  def buildWallet(
      proverClient: ProverClient[IO],
      txSubmissionService: TxSubmissionService[IO],
      syncService: SyncService[IO],
      laresService: LaresService[IO] = emptyLaresService,
      userId: UserId = UserId("test_user"),
  ): IO[Wallet[IO]] =
    Random.scalaUtilRandom[IO].map { implicit random =>
      new Wallet.Live[IO](
        new ProverService.Live[IO](proverClient, maxRetries = 1, retryDelay = 10.millis),
        txSubmissionService,
        syncService,
        laresService,
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

class WalletSyncSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletSpec
    with BetterOutputSuite {
  test("submit transaction requests") {
    forAllF(blockGen, Gen.containerOf[Seq, TransactionRequest](txRequestGen)) {
      (block: Block, txRequests: Seq[TransactionRequest]) =>
        val syncService = new SyncServiceStub(Seq(block))
        val laresService: LaresService[IO] = _ => (Seq.empty[SemanticEvent], txRequests).pure[IO]

        for {
          wallet <- buildWallet(proverClient, txSubmissionService, syncService, laresService)
          _ <- wallet.sync().compile.drain
        } yield txRequests.foreach { txRequest =>
          assert(
            txSubmissionService.submittedCallTransactions.exists { tx =>
              tx.contractHash === txRequest.contractId && tx.nonce === txRequest.nonce
            },
            txRequest.contractId,
          )
        }
    }
  }

  test("fail if tx submission fails") {
    forAllF(blockGen, Gen.nonEmptyContainerOf[Seq, TransactionRequest](txRequestGen)) {
      (block: Block, txRequests: Seq[TransactionRequest]) =>
        val syncService = new SyncServiceStub(Seq(block))
        val laresService: LaresService[IO] = _ => (Seq.empty[SemanticEvent], txRequests).pure[IO]

        buildWallet(proverClient, failingTxSubmissionService, syncService, laresService)
          .flatMap(_.sync().compile.drain)
          .attempt
          .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }
}
