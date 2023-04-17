package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.js.interop.util.StreamOps
import io.iohk.midnight.js.interop.util.StreamOps.FromObservable
import io.iohk.midnight.midnightMockedNodeApi.distDataBlockMod.Block
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.engine.config.NodeConnectionResourced
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceTracer

import java.time.Instant
import scala.scalajs.js
import scala.util.Try

// TODO: [PM-5832] Improve code coverage
@SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf", "org.wartremover.warts.ToString"))
object SyncServiceFactory {

  def apply[F[_]: Async](
      nodeConnectionResourced: NodeConnectionResourced,
  )(implicit rootTracer: Tracer[F, StructuredLog]): Resource[F, SyncService[F]] = {
    val syncServiceTracer = SyncServiceTracer.from(rootTracer)

    nodeConnectionResourced.syncSessionResource
      .flatMap(session => {
        session
          .sync()
          .toObservableProtocolStream
          .map { stream => () =>
            stream
              .evalTap {
                case StreamOps.Next(event) =>
                  val eventJs = event.asInstanceOf[js.Dynamic]
                  val additionalLogData = Try(eventJs.header.hash.asInstanceOf[String]).toOption
                    .map(height => Map("hash" -> height))
                    .getOrElse(Map.empty)

                  syncServiceTracer.syncBlockReceived(additionalLogData)
                case StreamOps.Error(error) =>
                  syncServiceTracer.syncFailed(error)
              }
              .flatMap {
                case StreamOps.Error(error) =>
                  Stream.raiseError(new Throwable(error.toString))
                case StreamOps.Next(value) => Stream.emit(value)
              }
              .evalMap(block => Async[F].delay(transformBlock(block)).rethrow)
          }
      })
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
