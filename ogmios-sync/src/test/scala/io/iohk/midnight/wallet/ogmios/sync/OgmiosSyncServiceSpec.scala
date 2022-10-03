package io.iohk.midnight.wallet.ogmios.sync

import cats.effect.IO
import cats.effect.std.Random
import cats.syntax.functor.*
import cats.syntax.traverse.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Block.Height
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash, Transaction}
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService.Error.UnexpectedMessageReceived
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncServiceSpec.transactionsGen
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync.Receive
import io.iohk.midnight.wallet.ogmios.tracer.ClientRequestResponseTrace
import io.iohk.midnight.wallet.ogmios.tracer.ClientRequestResponseTrace.UnexpectedMessage
import io.iohk.midnight.wallet.ogmios.util.{BetterOutputSuite, TestingTracer}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF

import java.util.concurrent.TimeUnit
import scala.annotation.tailrec
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

  def heights(amount: Int): List[Height] = {
    @tailrec
    def loop(idx: Int, prevHeight: Height, acc: List[Height]): List[Height] = {
      if (idx >= amount) acc.reverse
      else {
        val newHeight = prevHeight.increment
        loop(idx + 1, newHeight, newHeight :: acc)
      }
    }
    loop(1, Height.Genesis, List(Height.Genesis))
  }
  def expectedResults(transactions: Seq[Transaction]): List[(Transaction, Height)] =
    transactions.toList.zip(heights(transactions.length))

  def testService(
      title: String,
      initialResponses: Seq[Receive] = Seq.empty,
  )(
      theTest: (
          OgmiosSyncService[IO],
          JsonWebSocketClientSyncStub,
          TestingTracer[IO, ClientRequestResponseTrace],
      ) => PropF[IO],
  ): Unit =
    test(title) {
      Random
        .scalaUtilRandom[IO]
        .flatMap { implicit random =>
          JsonWebSocketClientSyncStub(initialResponses = initialResponses)
        }
        .fproduct { webSocketClient =>
          implicit val tracer: TestingTracer[IO, ClientRequestResponseTrace] =
            new TestingTracer[IO, ClientRequestResponseTrace]
          (OgmiosSyncService[IO](webSocketClient), tracer)
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
  ) { (syncService, webSocketClientStub, _) =>
    // RollBackward => RequestNext => clientIsAwaitingReply set to true
    val isClientAwaitingReply =
      syncService.sync().compile.drain.attempt >> webSocketClientStub.isClientAwaitingReply
    assertIO(isClientAwaitingReply, true)
  }

  testService(
    "Handles AwaitReply",
    initialResponses = Seq(Receive.AwaitReply, Receive.IntersectNotFound),
  ) { (syncService, webSocketClientStub, _) =>
    val isClientAwaitingReply =
      syncService.sync().compile.drain.attempt >> webSocketClientStub.isClientAwaitingReply
    assertIO(isClientAwaitingReply, true)
  }

  testService("Receives unexpected message", initialResponses = Seq(Receive.IntersectNotFound)) {
    (syncService, _, tracer) =>
      syncService.sync().compile.drain.attempt >>
        tracer.traced
          .map(
            assertEquals(
              _,
              Vector(
                UnexpectedMessage(UnexpectedMessageReceived(Receive.IntersectNotFound).getMessage),
              ),
            ),
          )
  }
}

object OgmiosSyncServiceSpec {
  val transactionsGen: Gen[Seq[Transaction]] =
    Gen.nonEmptyListOf(
      Gen.oneOf(
        examples.SubmitTx.validDeployTx,
        examples.SubmitTx.validCallTx,
      ),
    )
}
