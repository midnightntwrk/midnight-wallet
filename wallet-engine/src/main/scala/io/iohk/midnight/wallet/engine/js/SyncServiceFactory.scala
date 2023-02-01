package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.midnightMockedNodeApi.distDataBlockMod.Block
import io.iohk.midnight.midnightMockedNodeApi.distDataRequestNextResultMod.{
  ROLL_FORWARD,
  RequestNextResult,
  RollForward,
}
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import io.iohk.midnight.rxjs.distTypesMod.Observable_
import io.iohk.midnight.rxjs.mod.lastValueFrom
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.Instances.*
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.ouroboros.network.{
  JsonWebSocketClientTracer,
  SttpJsonWebSocketClient,
}
import io.iohk.midnight.wallet.ouroboros.sync.OuroborosSyncService
import io.iohk.midnight.wallet.ouroboros.sync.tracing.OuroborosSyncTracer
import java.time.Instant
import scala.scalajs.js
import scala.scalajs.js.Promise
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

object SyncServiceFactory {

  // Ugly code, will be simplified by using Ouroboros client from mocked-node
  // https://input-output.atlassian.net/browse/PM-5537
  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def fromNode[F[_]: Async](node: MockedNode[Transaction]): SyncService[F] =
    new SyncService[F] {
      private val chainSync = node.sync()

      override def sync(): Stream[F, data.Block] =
        Stream.repeatEval {
          Async[F]
            .fromPromise(Async[F].delay(requestNext))
            .flatMap(parseResponse)
        }

      private def parseResponse(result: RequestNextResult[Block[Transaction]]): F[data.Block] = {
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

      private def requestNext: Promise[RequestNextResult[Block[Transaction]]] =
        lastValueFrom(
          chainSync
            .requestNext()
            .asInstanceOf[Observable_[RequestNextResult[Block[Transaction]]]],
        )

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

  def connect[F[_]: Async](
      nodeUri: Uri,
      rootTracer: Tracer[F, StructuredLog],
  ): Resource[F, SyncService[F]] = {
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[F] =
      JsonWebSocketClientTracer.from(rootTracer)
    implicit val ogmiosSyncTracer: OuroborosSyncTracer[F] =
      OuroborosSyncTracer.from(rootTracer)
    val sttpBackend = FetchCatsBackend[F]()

    SttpJsonWebSocketClient[F](sttpBackend, nodeUri)
      .flatMap(OuroborosSyncService[F, data.Block])
      .map { ouroborosSync => () => ouroborosSync.sync }
  }
}
