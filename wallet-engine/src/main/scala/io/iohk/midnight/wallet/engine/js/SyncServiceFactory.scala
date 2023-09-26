package io.iohk.midnight.wallet.engine.js

import cats.Applicative
import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.functor.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.{Hash, Transaction}
import io.iohk.midnight.wallet.core.capabilities.WalletKeys
import io.iohk.midnight.wallet.core.domain.TransactionHash
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.{LedgerSerialization, WalletStateService}
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceTracer
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.indexer.IndexerClient.RawTransaction
import io.iohk.midnight.wallet.zswap
import sttp.model.Uri

object SyncServiceFactory {

  def apply[F[_]: Async, TWallet](
      indexerUri: Uri,
      indexerWsUri: Uri,
      walletStateService: WalletStateService[F, TWallet],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletKeys: WalletKeys[TWallet, zswap.CoinPublicKey, zswap.EncryptionSecretKey],
  ): Resource[F, SyncService[F]] = {
    val syncServiceTracer = SyncServiceTracer.from(rootTracer)

    IndexerClient[F](indexerUri, indexerWsUri)
      .evalMap(client => walletStateService.keys.map(_._2).map((client, _)))
      .map { case (client, viewingKey) =>
        (lastHash: Option[TransactionHash]) =>
          client
            .rawTransactions(
              LedgerSerialization.viewingKeyToString(viewingKey),
              lastHash.map(_.hash),
            )
            .attempt
            .evalTap {
              case Left(error) => syncServiceTracer.syncFailed(error)
              case _           => Applicative[F].unit
            }
            .collect { case Right(tx) =>
              tx
            }
            .evalTap(tx => syncServiceTracer.syncTransactionReceived(tx.hash))
            .map { case RawTransaction(hash, raw) => Transaction(Hash(hash), raw) }
      }
  }
}
