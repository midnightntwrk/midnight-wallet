package io.iohk.midnight.wallet.engine

import cats.effect.syntax.resource.*
import cats.effect.{Async, Resource}
import fs2.Stream
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, ProtocolVersion, Transaction}
import io.iohk.midnight.wallet.core.combinator.VersionCombinator.{
  ProvingServiceFactory,
  SubmissionServiceFactory,
  SyncServiceFactory,
}
import io.iohk.midnight.wallet.core.{Config as CoreConfig, *}
import io.iohk.midnight.wallet.core.combinator.{CombinationMigrations, VersionCombinator}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.engine.js.{ProvingServiceFactory, TxSubmissionServiceFactory}
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.zswap

class WalletBuilder[F[_]: Async, LocalState, Transaction] {
  def build(config: Config): Resource[F, VersionCombinator[F]] = {
    given rootTracer: Tracer[F, StructuredLog] =
      ConsoleTracer.contextAware[F, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    for {
      _ <- builderTracer.buildRequested(config).toResource
      combinator <- VersionCombinator(
        CoreConfig(config.initialState, config.discardTxHistory),
        submissionServiceFactory(config),
        provingServiceFactory(config),
        syncServiceFactory(config),
        CombinationMigrations.default[F],
      )
    } yield combinator
  }

  private def submissionServiceFactory(config: Config): SubmissionServiceFactory[F] =
    new SubmissionServiceFactory[F] {
      override def apply[TX: zswap.Transaction.IsSerializable](using
          zswap.NetworkId,
      ): Resource[F, TxSubmissionService[F, TX]] =
        TxSubmissionServiceFactory[F, TX](config.substrateNodeUri)
    }

  private def provingServiceFactory(config: Config): ProvingServiceFactory[F] =
    new ProvingServiceFactory[F] {
      override def apply[
          UTX: zswap.UnprovenTransaction.IsSerializable,
          TX: zswap.Transaction.IsSerializable,
      ](using ProtocolVersion, zswap.NetworkId): Resource[F, ProvingService[F, UTX, TX]] =
        ProvingServiceFactory[F, UTX, TX](config.provingServerUri)
    }

  private def syncServiceFactory(
      config: Config,
  )(using Tracer[F, StructuredLog]): SyncServiceFactory[F] =
    new SyncServiceFactory[F] {
      override def apply[ESK](esk: ESK, index: Option[BigInt])(using
          s: zswap.EncryptionSecretKey[ESK, ?],
          n: zswap.NetworkId,
      ): Resource[F, SyncService[F]] =
        IndexerClient[F](config.indexerWsUri).map { indexerClient =>
          new SyncService[F] {
            override def sync(offset: Option[Transaction.Offset]): Stream[F, IndexerEvent] =
              indexerClient.viewingUpdates(s.serialize(esk), index)
          }
        }
    }
}
