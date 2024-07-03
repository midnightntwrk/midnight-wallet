package io.iohk.midnight.wallet.engine

import cats.effect.{Async, Ref, Resource}
import cats.effect.syntax.resource.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.combinator.{
  ProtocolVersion,
  V1Combination,
  VersionCombination,
  VersionCombinator,
}
import io.iohk.midnight.wallet.core.domain.IndexerUpdate
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.{
  WalletSyncTracer,
  WalletTxServiceTracer,
  WalletTxSubmissionTracer,
}
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.engine.js.{
  ProvingServiceFactory,
  SyncServiceFactory,
  TxSubmissionServiceFactory,
}
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer
import io.iohk.midnight.wallet.zswap

object WalletBuilder {
  def build[F[_]: Async](config: Config): Resource[F, WalletDependencies[F]] =
    config.initialState.protocolVersion match {
      case ProtocolVersion.V1 =>
        buildWalletV1[F](config)
    }

  private def buildWalletV1[F[_]: Async](config: Config): Resource[F, WalletDependencies[F]] = {
    import Wallet.*
    implicit val rootTracer: Tracer[F, StructuredLog] =
      ConsoleTracer.contextAware[F, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    for {
      _ <- builderTracer.buildRequested(config).toResource
      walletStateContainer <- WalletStateContainer.Live(walletCreation.create(config.initialState))
      walletQueryStateService <- Resource.pure(
        new WalletQueryStateService.Live(walletStateContainer),
      )
      walletStateService <- Resource.pure(
        new WalletStateService.Live(walletQueryStateService),
      )
      submitTxService <- TxSubmissionServiceFactory(config.substrateNodeUri)
      provingService <- ProvingServiceFactory(config.provingServerUri)
      walletTxSubmissionService <- buildWalletTxSubmissionService(
        submitTxService,
        walletStateContainer,
      )
      syncService = SyncServiceFactory(config.indexerUri, config.indexerWsUri, walletStateService)
      walletBlockProcessingService <- buildWalletSyncService(
        syncService,
        walletStateContainer,
        config.initialState.offset,
      )
      walletTransactionService <- buildWalletTransactionService(
        walletStateContainer,
        provingService,
      )
      v1Combination = V1Combination(
        config.initialState,
        syncService,
        walletStateContainer,
        walletStateService,
      )
      combinationRef <- Resource.eval(Ref[F].of[VersionCombination[F]](v1Combination))
    } yield {
      WalletDependencies(
        VersionCombinator(combinationRef),
        walletTxSubmissionService,
        walletTransactionService,
      )
    }
  }

  private def buildWalletSyncService[F[_]: Async, TWallet](
      syncService: Resource[F, SyncService[F]],
      walletStateContainer: WalletStateContainer[F, TWallet],
      offset: Option[data.Transaction.Offset],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletSync: WalletSync[TWallet, IndexerUpdate],
  ): Resource[F, WalletSyncService[F]] = {
    implicit val walletSyncTracer: WalletSyncTracer[F] = WalletSyncTracer.from(rootTracer)
    WalletSyncService(syncService, walletStateContainer, offset)
  }

  private def buildWalletTxSubmissionService[F[_]: Async, TWallet](
      submitTxService: TxSubmissionService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletTxBalancing: WalletTxBalancing[TWallet, zswap.Transaction, zswap.UnprovenTransaction, ?],
  ): Resource[F, WalletTxSubmissionService[F]] = {
    implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[F] =
      WalletTxSubmissionTracer.from(rootTracer)
    Resource.pure(
      new WalletTxSubmissionService.Live[F, TWallet](submitTxService, walletStateContainer),
    )
  }

  private def buildWalletTransactionService[F[_]: Async, TWallet](
      walletStateContainer: WalletStateContainer[F, TWallet],
      provingService: ProvingService[F],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletTxBalancing: WalletTxBalancing[
        TWallet,
        zswap.Transaction,
        zswap.UnprovenTransaction,
        zswap.CoinInfo,
      ],
  ): Resource[F, WalletTransactionService[F]] = {
    given WalletTxServiceTracer[F] = WalletTxServiceTracer.from(rootTracer)
    Resource.pure(new WalletTransactionService.Live(walletStateContainer, provingService))
  }

  final case class WalletDependencies[F[_]](
      versionCombinator: VersionCombinator[F],
      submissionService: WalletTxSubmissionService[F],
      txService: WalletTransactionService[F],
  )
}
