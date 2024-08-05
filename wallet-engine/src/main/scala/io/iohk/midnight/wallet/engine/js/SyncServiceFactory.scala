package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.all.*
import cats.ApplicativeThrow
import fs2.Stream
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.WalletStateService
import io.iohk.midnight.wallet.core.capabilities.WalletKeys
import io.iohk.midnight.wallet.core.combinator.ProtocolVersion
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceTracer
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.{HexUtil, MerkleTreeCollapsedUpdate}
import scala.util.{Failure, Success, Try}
import sttp.model.Uri

object SyncServiceFactory {

  def apply[F[_]: Async, TWallet](
      indexerUri: Uri,
      indexerWsUri: Uri,
      walletStateService: WalletStateService[F, TWallet],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletKeys: WalletKeys[
        TWallet,
        zswap.CoinPublicKey,
        zswap.EncryptionPublicKey,
        zswap.EncryptionSecretKey,
      ],
  ): Resource[F, SyncService[F]] =
    IndexerClient[F](indexerWsUri)
      .evalMap(client => walletStateService.keys.map(_._3).map((client, _)))
      .map { (client, viewingKey) => (offset: Option[Transaction.Offset]) =>
        val syncServiceTracer = SyncServiceTracer.from(rootTracer)
        client
          .viewingUpdates(viewingKey.serialize, offset.map(_.value))
          .onError(error => Stream.eval(syncServiceTracer.syncFailed(error)))
          .evalTap(syncServiceTracer.viewingUpdateReceived)
          .evalMap {
            case IndexerClient.RawViewingUpdate(offset, rawUpdates) =>
              ApplicativeThrow[F].fromTry(viewingUpdate(rawUpdates, Transaction.Offset(offset)))

            case IndexerClient.RawProgressUpdate(synced, total) =>
              ProgressUpdate(Transaction.Offset(synced), Transaction.Offset(total)).pure[F]

            case IndexerClient.ConnectionLost =>
              ConnectionLost.pure
          }
      }

  def viewingUpdate(
      rawUpdates: Seq[IndexerClient.SingleUpdate],
      offset: Transaction.Offset,
  ): Try[ViewingUpdate] =
    rawUpdates
      .traverse {
        case IndexerClient.SingleUpdate.MerkleTreeCollapsedUpdate(v, mt) =>
          for {
            version <- ProtocolVersion.fromInt(v.getOrElse(ProtocolVersion.V1.version)).toTry
            decoded <- HexUtil.decodeHex(mt)
            mtcu <- MerkleTreeCollapsedUpdate.deserialize(decoded)
          } yield (version, mtcu.asLeft)
        case IndexerClient.SingleUpdate.RawTransaction(v, _, raw, applyStage) =>
          for {
            version <- ProtocolVersion.fromInt(v.getOrElse(ProtocolVersion.V1.version)).toTry
            decoded <- HexUtil.decodeHex(raw)
            tx <- Try(zswap.Transaction.deserialize(decoded))
            applyStage <- Try(ApplyStage.valueOf(applyStage))
          } yield (version, AppliedTransaction(tx, applyStage).asRight)
      }
      .flatMap { updates =>
        val updatesByVersion = updates.groupMap(_._1)(_._2).toSeq.toNeSeq
        updatesByVersion match {
          case None => Failure(Exception("Invalid empty viewing update"))
          case Some(neSeq) =>
            if (neSeq.size > 1) Failure(Exception(s"Invalid update versions: ${updates._1F}"))
            else Success(ViewingUpdate(neSeq.head._1, offset, neSeq.head._2))
        }
      }
}
