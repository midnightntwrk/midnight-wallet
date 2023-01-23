package io.iohk.midnight.wallet.ouroboros.sync

import cats.effect.IO
import cats.effect.std.Random
import cats.syntax.functor.*
import cats.syntax.traverse.*
import fs2.{Pure, Stream}
import io.iohk.midnight.tracer.logging.{InMemoryLogTracer, StringLogContext, StructuredLog}
import io.iohk.midnight.wallet.ouroboros.sync.OuroborosSyncServiceSpec.transactionsGen
import io.iohk.midnight.wallet.ouroboros.sync.TestDomain.Block.*
import io.iohk.midnight.wallet.ouroboros.sync.TestDomain.{Block, Transaction}
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.{Hash, Receive}
import io.iohk.midnight.wallet.ouroboros.sync.tracing.{OuroborosSyncEvent, OuroborosSyncTracer}
import io.iohk.midnight.wallet.ouroboros.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF

import java.util.concurrent.TimeUnit
import scala.concurrent.duration.FiniteDuration
import cats.effect.kernel.Resource
import cats.effect.kernel.Ref
import io.circe.Encoder
import io.circe.Decoder
import io.iohk.midnight.wallet.ouroboros.network.JsonWebSocketClient
import sttp.ws.WebSocketClosed
import scala.concurrent.duration.*

trait SyncServiceSpecBase
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  val delay: FiniteDuration = FiniteDuration(100, TimeUnit.MILLISECONDS)

  val heightStream: Stream[Pure, Int] = Stream.unfold(0)(b => Some((b, b + 1)))

  def emitBlocks(
      transactions: Seq[Transaction],
      nodeClientStub: JsonWebSocketClientSyncStub,
  ): Stream[IO, Unit] =
    Stream.eval(transactions.traverse(tx => nodeClientStub.emitBlock(Seq(tx))).void)

  def doSync(
      amount: Int,
      syncService: OuroborosSyncService[IO, Block],
  ): Stream[IO, (Transaction, Int)] =
    syncService.sync
      .take(amount.toLong)
      .collect { case Block(height, _, Seq(txs)) => (txs, height) }

  def expectedResults(transactions: Seq[Transaction]): List[(Transaction, Int)] =
    transactions.toList.zip(heightStream.take(transactions.length.toLong).toList)

  def testService(
      title: String,
      initialResponses: Seq[Receive[Block]] = Seq.empty,
  )(
      theTest: (
          OuroborosSyncService[IO, Block],
          JsonWebSocketClientSyncStub,
          InMemoryLogTracer[IO, StructuredLog],
      ) => PropF[IO],
  ): Unit =
    test(title) {
      Random
        .scalaUtilRandom[IO]
        .flatMap { implicit random =>
          JsonWebSocketClientSyncStub(initialResponses = initialResponses)
        }
        .fproduct { webSocketClient =>
          val inMemoryTracer = InMemoryLogTracer.unsafeContextAware[IO, StringLogContext]
          implicit val syncTracer: OuroborosSyncTracer[IO] =
            OuroborosSyncTracer.from(inMemoryTracer)
          (OuroborosSyncService[IO, Block](webSocketClient), inMemoryTracer)
        }
        .flatMap { case (nodeClient, (syncServiceR, tracer)) =>
          syncServiceR.use { syncService =>
            theTest(syncService, nodeClient, tracer).checkOne()
          }
        }
    }
}

class OuroborosSyncServiceSpec extends SyncServiceSpecBase {
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
      syncService.sync.compile.drain.attempt >> webSocketClientStub.isClientAwaitingReply
    val containsExpectedLogs: IO[Boolean] =
      tracer.getById(OuroborosSyncEvent.RollBackwardReceived.id).map(_.nonEmpty)

    assertIOBoolean(isClientAwaitingReply, "isClientAwaitingReply")
    >> assertIOBoolean (containsExpectedLogs, "containsExpectedLogs")
  }

  testService(
    "Handles AwaitReply",
    initialResponses = Seq(Receive.AwaitReply, Receive.IntersectNotFound),
  ) { (syncService, webSocketClientStub, tracer) =>
    val isClientAwaitingReply =
      syncService.sync.compile.drain.attempt >> webSocketClientStub.isClientAwaitingReply
    val containsExpectedLogs: IO[Boolean] =
      tracer.getById(OuroborosSyncEvent.AwaitReplyReceived.id).map(_.nonEmpty)

    assertIOBoolean(isClientAwaitingReply, "isClientAwaitingReply")
    >> assertIOBoolean (containsExpectedLogs, "containsExpectedLogs")
  }

  testService("Receives unexpected message", initialResponses = Seq(Receive.IntersectNotFound)) {
    (syncService, _, tracer) =>
      val containsExpectedLogs =
        syncService.sync.compile.drain.attempt >> tracer
          .getById(OuroborosSyncEvent.UnexpectedMessage.id)
          .map(_.nonEmpty)
      assertIOBoolean(containsExpectedLogs)
  }

  test("Sync stream should complete without error when resources are released") {
    import OuroborosSyncServiceSpec.*

    val inMemoryTracer = InMemoryLogTracer.unsafeContextAware[IO, StringLogContext]
    implicit val tracer: OuroborosSyncTracer[IO] = OuroborosSyncTracer.from(inMemoryTracer)

    val resources =
      ClosingWsStub().flatMap(OuroborosSyncService.apply[IO, Block]).allocated

    def runFinalizer(finalizer: IO[Unit]) = Stream.eval(finalizer).delayBy(300.millis)

    resources
      .flatMap { case (syncService, finalizer) =>
        syncService.sync
          .concurrently(runFinalizer(finalizer))
          .compile
          .drain
          .attempt
      }
      .map { res =>
        assert(res.isRight)
      }
  }

}

object OuroborosSyncServiceSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(Gen.const(examples.SubmitTx.validTx))

  class ClosingWsStub extends JsonWebSocketClient[IO] {
    private val isClosed: Ref[IO, Boolean] = Ref.unsafe(false)

    override def send[T: Encoder](message: T): IO[Unit] = IO.unit

    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    override def receive[T: Decoder](): IO[T] =
      isClosed.get.ifM(
        IO.raiseError(WebSocketClosed(None)),
        IO.pure(Receive.AwaitReply.asInstanceOf[T]),
      )

    def close: IO[Unit] = isClosed.set(true)
  }

  object ClosingWsStub {
    def apply(): Resource[IO, ClosingWsStub] =
      Resource.make(IO.pure(new ClosingWsStub()))(_.close)
  }
}
