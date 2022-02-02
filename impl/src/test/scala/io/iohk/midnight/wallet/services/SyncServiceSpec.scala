package io.iohk.midnight.wallet.services

import cats.effect.IO
import cats.effect.std.Random
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.clients.platform.PlatformClientStub
import io.iohk.midnight.wallet.clients.platform.examples.SubmitTx
import io.iohk.midnight.wallet.domain.{Block, Transaction, TransactionWithReceipt}
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse.{Accepted, Rejected}
import io.iohk.midnight.wallet.services.SyncServiceSpec.transactionsGen
import io.iohk.midnight.wallet.util.HashOps.*
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF

trait SyncServiceSpecBase extends CatsEffectSuite with ScalaCheckEffectSuite {
  def testService(
      title: String,
  )(theTest: (SyncService[IO], PlatformClientStub) => PropF[IO]): Unit =
    test(title) {
      Random
        .scalaUtilRandom[IO]
        .flatMap { implicit random => PlatformClientStub() }
        .fproduct(SyncService.Live[IO](_, 10))
        .flatMap { case (platformClient, syncService) =>
          syncService.use(theTest(_, platformClient).checkOne())
        }
    }
}

@SuppressWarnings(Array("org.wartremover.warts.Product", "org.wartremover.warts.Serializable"))
class SyncServiceSpec extends SyncServiceSpecBase {
  testService("Submits txs and receives corresponding responses") { (syncService, _) =>
    forAllF(transactionsGen) { transactions =>
      submitTransactionsAndVerifyResponses(transactions, syncService)
    }
  }

  private def submitTransactionsAndVerifyResponses(
      transactions: Seq[Transaction],
      syncService: SyncService[IO],
  ): IO[Unit] =
    transactions
      .fproduct { tx =>
        if (tx == SubmitTx.validObjectCall.payload) Accepted
        else Rejected(PlatformClientStub.rejectDetails.reason)
      }
      .parTraverse { case (tx, expected) =>
        syncService.submitTransaction(tx).map(assertEquals(_, expected))
      }
      .void

  testService("Receives blocks in order") { (syncService, platformClientStub) =>
    forAllF(transactionsGen) { transactions =>
      emitBlocks(transactions, syncService, platformClientStub)
        .flatMap(verifySyncedBlocks)
    }
  }

  private def emitBlocks(
      transactions: Seq[Transaction],
      syncService: SyncService[IO],
      platformClientStub: PlatformClientStub,
  ): IO[Stream[IO, ((Block, Block.Height), Transaction)]] =
    for {
      _ <- transactions.traverse(tx => platformClientStub.emitBlock(Seq(tx))).void
      stream <- syncService.sync()
    } yield {
      stream.take(transactions.length.toLong).zip(heightStream).zip(Stream.emits(transactions))
    }

  private val heightStream = Stream.unfold(Block.Height.Genesis)(b => Some((b, b.increment)))

  private def verifySyncedBlocks(
      blocks: Stream[IO, ((Block, Block.Height), Transaction)],
  ): IO[Unit] =
    blocks
      .map { case ((block, expectedHeight), submittedTransaction) =>
        assertEquals(block.header.height, expectedHeight)
        block.transactions match {
          case Seq(TransactionWithReceipt(tx, _)) => assertEquals(tx, submittedTransaction)
          case other => fail(s"Expected exactly 1 tx but got ${other.toString}")
        }
      }
      .compile
      .drain

  testService("Submit txs and sync blocks concurrently") { (syncService, platformClientStub) =>
    forAllF(transactionsGen) { transactions =>
      (
        emitBlocks(transactions, syncService, platformClientStub).flatMap(verifySyncedBlocks),
        submitTransactionsAndVerifyResponses(transactions, syncService),
      ).parTupled.void
    }
  }
}

object SyncServiceSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(
      Gen.oneOf(SubmitTx.validObjectDeploy.payload, SubmitTx.validObjectCall.payload),
    )
}
