package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.js.interop.util.StreamOps.FromObservable
import io.iohk.midnight.midnightMockedNodeApi.distDataBlockMod.Block
import io.iohk.midnight.midnightMockedNodeApi.distDataRequestNextResultMod.{
  ROLL_FORWARD,
  RequestNextResult,
  RollForward,
}
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import io.iohk.midnight.midnightMockedNodeClient.*
import io.iohk.midnight.pino.mod.pino.LoggerOptions
import io.iohk.midnight.rxjs.distTypesMod.Observable_
import io.iohk.midnight.rxjs.mod.lastValueFrom
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.services.SyncService
import sttp.model.Uri

import java.time.Instant
import scala.scalajs.js
import scala.scalajs.js.Promise

@SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
object SyncServiceFactory {

  // Ugly code, will be simplified by using TestSystem from mocked-node
  // https://input-output.atlassian.net/browse/PM-5758
  def fromNode[F[_]: Async](node: MockedNode[Transaction]): SyncService[F] = {
    def parseResponse(
        result: RequestNextResult[Block[Transaction]],
    ): F[data.Block] = {
      val tag = result.asInstanceOf[js.Dynamic].tag.asInstanceOf[String]
      if (tag === ROLL_FORWARD) {
        Async[F].delay {
          transformBlock(result.asInstanceOf[RollForward[Block[Transaction]]].block)
        }.rethrow
      } else {
        Async[F].raiseError {
          new Throwable(s"Invalid RequestNextResult type '$tag'")
        }
      }
    }

    new SyncService[F] {
      private val chainSync = node.sync()

      override def sync(): Stream[F, data.Block] =
        Stream.repeatEval {
          Async[F]
            .fromPromise(Async[F].delay(requestNext))
            .flatMap(parseResponse(_))
        }

      private def requestNext: Promise[RequestNextResult[Block[Transaction]]] =
        lastValueFrom(
          chainSync
            .requestNext()
            .asInstanceOf[Observable_[RequestNextResult[Block[Transaction]]]],
        )

    }
  }

  def fromMockedNodeClient[F[_]: Async](nodeUri: Uri): Resource[F, SyncService[F]] = {
    // This logger needs to be adjusted to the existing tracing solutions.
    // https://input-output.atlassian.net/browse/PM-5761
    val pinoLogger = io.iohk.midnight.pino.mod.default.apply[LoggerOptions]()
    val clientF = Async[F].fromPromise(Async[F].delay(mod.client(nodeUri.toString(), pinoLogger)))
    val clientR = Resource.make(clientF)(client => Async[F].delay(client.close()))

    clientR
      .flatMap { client => client.sync().toStream() }
      .map { stream => () =>
        stream
          .filter(_.asInstanceOf[js.Dynamic].tag.asInstanceOf[String] === ROLL_FORWARD)
          .map(_.asInstanceOf[RollForward[Block[Transaction]]])
          .evalMap(rollForward => Async[F].delay(transformBlock(rollForward.block)).rethrow)
      }
  }

  private def transformBlock(block: Block[Transaction]): Either[Throwable, data.Block] =
    transformBlockHeader(block).map(data.Block(_, transformBlockBody(block)))

  private def transformBlockBody(block: Block[Transaction]): data.Block.Body =
    data.Block.Body(block.body.transactionResults.toSeq.map(transformTransaction))

  private def transformBlockHeader(
      block: Block[Transaction],
  ): Either[Throwable, data.Block.Header] =
    data.Block
      .Height(block.header.height.intValue())
      .bimap(
        new Throwable(_),
        data.Block.Header(
          data.Hash(block.header.hash),
          data.Hash(block.header.parentHash),
          _,
          Instant.ofEpochMilli(block.header.timestamp.getTime().longValue()),
        ),
      )

  private def transformTransaction(tx: Transaction): data.Transaction =
    data.Transaction(data.Transaction.Header(data.Hash(tx.header.hash)), tx.body)

}
