package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.Block.Height.Genesis
import io.iohk.midnight.wallet.blockchain.data.Generators.transactionGen
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash, Transaction}
import io.iohk.midnight.wallet.core.Wallet.TransactionRejected
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import java.time.Instant
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

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
    forAllF(transactionGen) { (tx: Transaction) =>
      defaultWallet()
        .submitTransaction(tx)
        .map { r =>
          assertEquals(r.value, tx.header.hash.value)
        }
    }
  }

  test("transactions get submitted to the client") {
    forAllF(transactionGen, transactionGen) { (tx1: Transaction, tx2: Transaction) =>
      val wallet = defaultWallet()
      for {
        hash1 <- wallet.submitTransaction(tx1)
        hash2 <- wallet.submitTransaction(tx2)
        wasSubmitted1 = txSubmissionService.wasTxSubmitted(hash1)
        wasSubmitted2 = txSubmissionService.wasTxSubmitted(hash2)
      } yield assert(wasSubmitted1 && wasSubmitted2)
    }
  }

  test("fails when node submission fails") {
    forAllF(transactionGen) { (tx: Transaction) =>
      val wallet = buildWallet(failingTxSubmissionService, syncService)

      wallet
        .submitTransaction(tx)
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("fails when node submission got rejected") {
    forAllF(transactionGen) { (tx: Transaction) =>
      val wallet = buildWallet(new RejectedTxSubmissionServiceStub(), syncService)

      wallet
        .submitTransaction(tx)
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
