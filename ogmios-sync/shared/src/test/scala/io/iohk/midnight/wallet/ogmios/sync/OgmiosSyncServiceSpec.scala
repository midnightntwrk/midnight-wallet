package io.iohk.midnight.wallet.ogmios.sync

import cats.effect.IO
import cats.effect.std.Random
import cats.syntax.functor.*
import cats.syntax.traverse.*
import fs2.Stream
import io.iohk.midnight.tracer.logging.{ContextAwareLog, InMemoryLogTracer}
import io.iohk.midnight.wallet.blockchain.data.Block.Height
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash, Transaction}
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncServiceSpec.transactionsGen
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync.Receive
import io.iohk.midnight.wallet.ogmios.sync.tracing.{OgmiosSyncEvent, OgmiosSyncTracer}
import io.iohk.midnight.wallet.ogmios.util.BetterOutputSuite
import java.util.concurrent.TimeUnit
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.FiniteDuration

trait SyncServiceSpecBase
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  val delay: FiniteDuration = FiniteDuration(100, TimeUnit.MILLISECONDS)

  val heightStream = Stream.unfold(Block.Height.Genesis)(b => Some((b, b.increment)))

  def emitBlocks(
      transactions: Seq[Transaction],
      nodeClientStub: JsonWebSocketClientSyncStub,
  ): Stream[IO, Unit] =
    Stream.eval(transactions.traverse(tx => nodeClientStub.emitBlock(Seq(tx))).void)

  def doSync(amount: Int, syncService: OgmiosSyncService[IO]): Stream[IO, (Transaction, Height)] =
    syncService
      .sync()
      .take(amount.toLong)
      .collect { case Block(header, Block.Body(Seq(tx))) =>
        (tx, header.height)
      }

  def expectedResults(transactions: Seq[Transaction]): List[(Transaction, Height)] =
    transactions.toList.zip(heightStream.take(transactions.length.toLong).toList)

  def testService(
      title: String,
      initialResponses: Seq[Receive] = Seq.empty,
  )(
      theTest: (
          OgmiosSyncService[IO],
          JsonWebSocketClientSyncStub,
          InMemoryLogTracer[IO, ContextAwareLog],
      ) => PropF[IO],
  ): Unit =
    test(title) {
      Random
        .scalaUtilRandom[IO]
        .flatMap { implicit random =>
          JsonWebSocketClientSyncStub(initialResponses = initialResponses)
        }
        .fproduct { webSocketClient =>
          val inMemoryTracer = InMemoryLogTracer.unsafeContextAware[IO]
          implicit val syncTracer: OgmiosSyncTracer[IO] = OgmiosSyncTracer.from(inMemoryTracer)
          (OgmiosSyncService[IO](webSocketClient), inMemoryTracer)
        }
        .flatMap { case (nodeClient, (syncService, tracer)) =>
          theTest(syncService, nodeClient, tracer).checkOne()
        }
    }
}

class OgmiosSyncServiceSpec extends SyncServiceSpecBase {
  testService("Receives blocks in order") { (syncService, nodeClientStub, _) =>
    forAllF(transactionsGen) { transactions =>
      val syncResult = (emitBlocks(transactions, nodeClientStub) >> doSync(
        transactions.length,
        syncService,
      )).compile.toList
      syncResult.assertEquals(expectedResults(transactions))
    }
  }

  testService(
    "Receives RollBackward and continue syncing",
    initialResponses = Seq(Receive.RollBackward(Hash("")), Receive.IntersectNotFound),
  ) { (syncService, webSocketClientStub, tracer) =>
    // RollBackward => RequestNext => clientIsAwaitingReply set to true
    val isClientAwaitingReply =
      syncService.sync().compile.drain.attempt >> webSocketClientStub.isClientAwaitingReply
    val containsExpectedLogs: IO[Boolean] =
      tracer.getById(OgmiosSyncEvent.RollBackwardReceived.id).map(_.nonEmpty)

    assertIOBoolean(isClientAwaitingReply, "isClientAwaitingReply")
    >> assertIOBoolean (containsExpectedLogs, "containsExpectedLogs")
  }

  testService(
    "Handles AwaitReply",
    initialResponses = Seq(Receive.AwaitReply, Receive.IntersectNotFound),
  ) { (syncService, webSocketClientStub, tracer) =>
    val isClientAwaitingReply =
      syncService.sync().compile.drain.attempt >> webSocketClientStub.isClientAwaitingReply
    val containsExpectedLogs: IO[Boolean] =
      tracer.getById(OgmiosSyncEvent.AwaitReplyReceived.id).map(_.nonEmpty)

    assertIOBoolean(isClientAwaitingReply, "isClientAwaitingReply")
    >> assertIOBoolean (containsExpectedLogs, "containsExpectedLogs")
  }

  testService("Receives unexpected message", initialResponses = Seq(Receive.IntersectNotFound)) {
    (syncService, _, tracer) =>
      val containsExpectedLogs =
        syncService.sync().compile.drain.attempt >> tracer
          .getById(OgmiosSyncEvent.UnexpectedMessage.id)
          .map(_.nonEmpty)
      assertIOBoolean(containsExpectedLogs)
  }
}

object OgmiosSyncServiceSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(Gen.const(examples.SubmitTx.validTx))
}
