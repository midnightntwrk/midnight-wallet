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
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF
import scala.scalajs.js
import typings.midnightLedger.mod.*

trait WalletSpec {
  val txSubmissionService = new TxSubmissionServiceStub()
  val failingTxSubmissionService = new FailingTxSubmissionServiceStub()
  val syncService = new SyncServiceStub()
  val failingSyncService = new FailingSyncServiceStub()

  def buildWallet(
      txSubmissionService: TxSubmissionService[IO] = txSubmissionService,
      syncService: SyncService[IO] = syncService,
      initialState: ZSwapLocalState = new ZSwapLocalState(),
  ): IO[Wallet[IO]] =
    Wallet.Live[IO](
      txSubmissionService,
      syncService,
      initialState,
    )

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
      buildWallet()
        .flatMap(_.submitTransaction(tx))
        .map(r => assertEquals(r.value, tx.header.hash.value))
    }
  }

  test("transactions get submitted to the client") {
    forAllF(transactionGen, transactionGen) { (tx1: Transaction, tx2: Transaction) =>
      for {
        wallet <- buildWallet()
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
        .flatMap(_.submitTransaction(tx))
        .attempt
        .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
    }
  }

  test("fails when node submission got rejected") {
    forAllF(transactionGen) { (tx: Transaction) =>
      val wallet = buildWallet(new RejectedTxSubmissionServiceStub(), syncService)

      wallet
        .flatMap(_.submitTransaction(tx))
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
      .flatMap(_.sync().compile.to(List))
      .attempt
      .map {
        case Left(error) => fail("failed", error)
        case Right(syncResult) =>
          assert(syncResult.length === 1)
      }
  }
}

class WalletBalanceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletSpec
    with BetterOutputSuite {
  test("Start with balance zero") {
    buildWallet()
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(js.BigInt(0))))
  }

  test("Sum transaction outputs to this wallet") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val coins = Gen.nonEmptyListOf(Generators.coinInfoGen).sample.get
    val (tx, state) = Generators.buildTransaction(coins)
    val expected = coins.map(_.value).fold(js.BigInt(0))(_ + _)
    buildWallet(initialState = state.applyLocal(tx))
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(expected)))
  }

  test("Not sum transaction outputs to another wallet") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.transactionGen.sample.get
    val anotherState = new ZSwapLocalState()
    buildWallet(initialState = anotherState.applyLocal(tx))
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(js.BigInt(0))))
  }
}
