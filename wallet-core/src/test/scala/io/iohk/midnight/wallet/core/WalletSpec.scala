package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.Block.Height.Genesis
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash}
import io.iohk.midnight.wallet.core.Wallet.{
  CallContractInput,
  DeployContractInput,
  TransactionRejected,
}
import io.iohk.midnight.wallet.core.domain.Generators.{callContractInputGen, deployContractInputGen}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

import java.time.Instant

trait WalletSpec {
  val txSubmissionService = new TxSubmissionServiceStub()
  val failingTxSubmissionService = new FailingTxSubmissionServiceStub()
  val syncService = new SyncServiceStub()
  val failingSyncService = new FailingSyncServiceStub()

  def buildWallet(
      txSubmissionService: TxSubmissionService[IO],
      syncService: SyncService[IO],
  ): Wallet[IO] =
    new Wallet.Live[IO](
      txSubmissionService,
      syncService,
    )

  def defaultWallet(): Wallet[IO] =
    buildWallet(txSubmissionService, syncService)

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
      defaultWallet()
        .callContract(input)
        .map { r =>
          assertEquals(r.value, input.hash.value)
        }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(callContractInputGen, callContractInputGen) {
      (input1: CallContractInput, input2: CallContractInput) =>
        val wallet = defaultWallet()
        for {
          hash1 <- wallet.callContract(input1)
          hash2 <- wallet.callContract(input2)
          wasSubmitted1 = txSubmissionService.wasCallTxSubmitted(hash1)
          wasSubmitted2 = txSubmissionService.wasCallTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when platform submission fails") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(failingTxSubmissionService, syncService)

      wallet
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("fails when platform submission got rejected") {
    forAllF(callContractInputGen) { (input: CallContractInput) =>
      val wallet = buildWallet(new RejectedTxSubmissionServiceStub(), syncService)

      wallet
        .callContract(input)
        .attempt
        .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
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
      defaultWallet().deployContract(input).map { r =>
        assertEquals(r.value, input.hash.value)
      }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(deployContractInputGen, deployContractInputGen) {
      (input1: DeployContractInput, input2: DeployContractInput) =>
        val wallet = defaultWallet()
        for {
          hash1 <- wallet.deployContract(input1)
          hash2 <- wallet.deployContract(input2)
          wasSubmitted1 = txSubmissionService.wasDeployTxSubmitted(hash1)
          wasSubmitted2 = txSubmissionService.wasDeployTxSubmitted(hash2)
        } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when platform submission fails") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      buildWallet(failingTxSubmissionService, syncService)
        .deployContract(input)
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("fails when platform submission got rejected") {
    forAllF(deployContractInputGen) { (input: DeployContractInput) =>
      buildWallet(new RejectedTxSubmissionServiceStub(), syncService)
        .deployContract(input)
        .attempt
        .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
    }
  }
}

class WalletSyncSpec extends CatsEffectSuite with WalletSpec with BetterOutputSuite {
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
          body = Block.Body(Seq.empty),
        ),
      ),
    )

    buildWallet(txSubmissionService, singleBlockSyncService)
      .sync()
      .compile
      .to(List)
      .attempt
      .map {
        case Left(error) => fail("failed", error)
        case Right(syncResult) =>
          assert(syncResult.length === 1)
      }
  }
}
