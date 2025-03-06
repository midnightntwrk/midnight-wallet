package io.iohk.midnight.wallet.engine

import cats.effect.{IO, Resource}
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.Config as CoreConfig
import io.iohk.midnight.wallet.core.combinator.VersionCombinator.{
  ProvingServiceFactory,
  SubmissionServiceFactory,
  SyncServiceFactory,
}
import io.iohk.midnight.wallet.core.combinator.{CombinationMigrations, VersionCombinator}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.engine.js.{ProvingServiceFactory, TxSubmissionServiceFactory}
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.zswap

class WalletBuilder[LocalStateNoKeys, Transaction] {
  def build(config: Config): Resource[IO, VersionCombinator] = {
    given rootTracer: Tracer[IO, StructuredLog] =
      ConsoleTracer.contextAware[IO, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    for {
      _ <- builderTracer.buildRequested(config).toResource
      combinator <- VersionCombinator(
        CoreConfig(config.initialState, config.seed, config.discardTxHistory),
        submissionServiceFactory(config),
        provingServiceFactory(config),
        syncServiceFactory(config),
        CombinationMigrations.default,
      )
    } yield combinator
  }

  private def submissionServiceFactory(config: Config): SubmissionServiceFactory =
    new SubmissionServiceFactory {
      override def apply[TX: zswap.Transaction.IsSerializable](using
          zswap.NetworkId,
      ): Resource[IO, TxSubmissionService[TX]] =
        TxSubmissionServiceFactory[TX](config.substrateNodeUri)
    }

  private def provingServiceFactory(
      config: Config,
  )(using Tracer[IO, StructuredLog]): ProvingServiceFactory =
    new ProvingServiceFactory {
      override def apply[
          UTX: zswap.UnprovenTransaction.IsSerializable,
          TX: zswap.Transaction.IsSerializable,
      ](using ProtocolVersion, zswap.NetworkId): Resource[IO, ProvingService[UTX, TX]] =
        ProvingServiceFactory[UTX, TX](config.provingServerUri)
    }

  private def syncServiceFactory(
      config: Config,
  )(using Tracer[IO, StructuredLog]): SyncServiceFactory =
    new SyncServiceFactory {
      override def apply[ESK](esk: ESK, index: Option[BigInt])(using
          s: zswap.EncryptionSecretKey[ESK, ?],
          n: zswap.NetworkId,
      ): Resource[IO, SyncService] =
        IndexerClient(config.indexerWsUri).map { indexerClient =>
          new DefaultSyncService[ESK](indexerClient, esk, index)
        }
    }
}
