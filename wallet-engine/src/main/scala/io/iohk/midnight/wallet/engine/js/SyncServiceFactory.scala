package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.all.*
import cats.{Applicative, ApplicativeThrow}
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.WalletStateService
import io.iohk.midnight.wallet.core.capabilities.WalletKeys
import io.iohk.midnight.wallet.core.domain.ViewingUpdate
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceTracer
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.indexer.IndexerClient.{RawViewingUpdate, SingleUpdate}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.{HexUtil, MerkleTreeCollapsedUpdate}
import scala.util.Try
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
  ): Resource[F, SyncService[F]] = {
    val syncServiceTracer = SyncServiceTracer.from(rootTracer)

    IndexerClient[F](indexerUri, indexerWsUri)
      .evalMap(client => walletStateService.keys.map(_._3).map((client, _)))
      .map { case (client, viewingKey) =>
        (blockHeight: Option[Block.Height]) =>
          client
            .viewingUpdates(
              viewingKey.serialize,
              blockHeight.map(_.value),
            )
            .attempt
            .evalTap {
              case Left(error) => syncServiceTracer.syncFailed(error)
              case _           => Applicative[F].unit
            }
            .collect { case Right(viewingUpdate) => viewingUpdate }
            .evalTap(syncServiceTracer.viewingUpdateReceived)
            .evalMap { case RawViewingUpdate(blockHeight, rawUpdates) =>
              val viewingUpdate =
                rawUpdates
                  .traverse[Try, Either[MerkleTreeCollapsedUpdate, zswap.Transaction]] {
                    case SingleUpdate.MerkleTreeCollapsedUpdate(mt) =>
                      HexUtil
                        .decodeHex(mt)
                        .flatMap(MerkleTreeCollapsedUpdate.deserialize)
                        .map(_.asLeft)
                    case SingleUpdate.RawTransaction(_, raw) =>
                      HexUtil.decodeHex(raw).map(zswap.Transaction.deserialize).map(_.asRight)
                  }
                  .flatMap(updates =>
                    Block
                      .Height(blockHeight)
                      .map(ViewingUpdate(_, updates))
                      .leftMap(Exception(_))
                      .toTry,
                  )

              ApplicativeThrow[F].fromTry(viewingUpdate)
            }
      }
  }
}
