package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.wallet.core.Wallet.TransactionRejected
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import scala.scalajs.js
import typings.midnightLedger.mod.*
import typings.node.bufferMod.global.BufferEncoding

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
    Wallet.Live[IO](txSubmissionService, syncService, initialState)
}

class WalletTxSubmissionSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with WalletSpec
    with BetterOutputSuite {

  test("The first transaction identifier is returned") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    buildWallet()
      .flatMap(_.submitTransaction(tx))
      .map { r =>
        assertEquals(
          Option(r.serialize().toString(BufferEncoding.hex)),
          tx.identifiers().headOption.map(_.serialize().toString(BufferEncoding.hex)),
        )
      }
  }

  test("Transactions get submitted to the client") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx1, _) = Generators.ledgerTransactionGen.sample.get
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx2, _) = Generators.ledgerTransactionGen.sample.get
    for {
      wallet <- buildWallet()
      _ <- wallet.submitTransaction(tx1)
      _ <- wallet.submitTransaction(tx2)
      wasSubmitted1 = txSubmissionService.wasTxSubmitted(tx1)
      wasSubmitted2 = txSubmissionService.wasTxSubmitted(tx2)
    } yield assert(wasSubmitted1 && wasSubmitted2)
  }

  test("Fails when submission fails") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet(failingTxSubmissionService, syncService)

    wallet
      .flatMap(_.submitTransaction(tx))
      .attempt
      .map(assertEquals(_, Left(FailingTxSubmissionServiceStub.TxSubmissionServiceError)))
  }

  test("Fails when submission is rejected") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val wallet = buildWallet(new RejectedTxSubmissionServiceStub(), syncService)

    wallet
      .flatMap(_.submitTransaction(tx))
      .attempt
      .map(assertEquals(_, Left(TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg))))
  }
}

class WalletSyncSpec extends CatsEffectSuite with WalletSpec with BetterOutputSuite {
  test("Syncs transactions") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val blocks = Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, Generators.blockGen)).sample.get
    buildWallet(txSubmissionService, new SyncServiceStub(blocks))
      .flatMap(_.sync().compile.to(List))
      .map { result =>
        val obtained = result.map(_.transactionHash().serialize().toString(BufferEncoding.hex))
        val expected = blocks.flatMap(_.body.transactionResults.map(_.header.hash.value))
        assertEquals(obtained, expected)
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
    val coins = Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, Generators.coinInfoGen)).sample.get
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
    val (tx, _) = Generators.ledgerTransactionGen.sample.get
    val anotherState = new ZSwapLocalState()
    buildWallet(initialState = anotherState.applyLocal(tx))
      .map(_.balance())
      .flatMap(_.head.compile.last)
      .map(assertEquals(_, Some(js.BigInt(0))))
  }
}

class WalletPublicKeySpec extends CatsEffectSuite with WalletSpec with BetterOutputSuite {
  test("Return the public key") {
    val initialState = new ZSwapLocalState()
    val expected = initialState.coinPublicKey.serialize().toString(BufferEncoding.hex)
    buildWallet(initialState = initialState)
      .flatMap(_.publicKey())
      .map(_.serialize().toString(BufferEncoding.hex))
      .map(assertEquals(_, expected))
  }
}
