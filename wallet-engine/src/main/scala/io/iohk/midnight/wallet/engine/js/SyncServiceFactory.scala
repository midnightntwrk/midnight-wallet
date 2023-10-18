package io.iohk.midnight.wallet.engine.js

import cats.{Applicative, ApplicativeThrow}
import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.all.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.WalletStateService
import io.iohk.midnight.wallet.core.capabilities.WalletKeys
import io.iohk.midnight.wallet.core.domain.{TransactionHash, ViewingUpdate}
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceTracer
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.indexer.IndexerClient.RawViewingUpdate
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.{HexUtil, MerkleTreeCollapsedUpdate}
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
        (lastHash: Option[TransactionHash], lastIndex: Option[BigInt]) =>
          client
            .viewingUpdates(
              viewingKey.serialize,
              lastHash.map(_.hash),
              lastIndex,
            )
            .attempt
            .evalTap {
              case Left(error) => syncServiceTracer.syncFailed(error)
              case _           => Applicative[F].unit
            }
            .collect { case Right(viewingUpdate) => viewingUpdate }
            .evalTap(syncServiceTracer.viewingUpdateReceived)
            .evalMap { case RawViewingUpdate(rawMerkleTree, rawTxs) =>
              val update = for {
                merkleTree <- rawMerkleTree.traverse { (mt, index) =>
                  HexUtil
                    .decodeHex(mt)
                    .flatMap(MerkleTreeCollapsedUpdate.deserialize)
                    .tupleRight(index)
                }
                txs <- rawTxs.traverse { rawTx =>
                  HexUtil.decodeHex(rawTx.raw).map(zswap.Transaction.deserialize)
                }
              } yield ViewingUpdate(merkleTree, txs.toVector)

              ApplicativeThrow[F].fromTry(update)
            }
      }
  }
}
