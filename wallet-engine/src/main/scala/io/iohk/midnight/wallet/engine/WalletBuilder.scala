package io.iohk.midnight.wallet.engine

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.effect.syntax.resource.*
import cats.syntax.all.*
import io.iohk.midnight.midnightLedger.mod
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.{
  BalanceTransactionTracer,
  WalletBlockProcessingTracer,
  WalletFilterTracer,
  WalletTxSubmissionTracer,
}
import io.iohk.midnight.wallet.engine.config.NodeConnection.{NodeInstance, NodeUri}
import io.iohk.midnight.wallet.engine.config.{Config, NodeConnection}
import io.iohk.midnight.wallet.engine.js.{SyncServiceFactory, TxSubmissionServiceFactory}
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer

object WalletBuilder {
  final case class WalletDependencies[F[_], TWallet](
      walletBlockProcessingService: WalletBlockProcessingService[F],
      walletStateService: WalletStateService[F, TWallet],
      walletFilterService: WalletFilterService[F],
      walletTxSubmissionService: WalletTxSubmissionService[F],
  )
  final case class AllocatedWallet[F[_], TWallet](
      dependencies: WalletDependencies[F, TWallet],
      finalizer: F[Unit],
  )

  def build[F[_]: Async](
      config: Config,
  ): F[AllocatedWallet[F, Wallet]] = {
    import Wallet.*
    buildWallet[F, Wallet](config)
  }

  private def buildWallet[F[_]: Async, TWallet](config: Config)(implicit
      walletCreation: WalletCreation[TWallet, ZSwapLocalState],
      walletTxBalancing: WalletTxBalancing[TWallet, mod.Transaction, mod.CoinInfo],
      walletBlockProcessing: WalletBlockProcessing[TWallet, Block],
  ): F[AllocatedWallet[F, TWallet]] = {
    implicit val rootTracer: Tracer[F, StructuredLog] =
      ConsoleTracer.contextAware[F, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    val dependencies = for {
      _ <- builderTracer.buildRequested(config).toResource
      (syncService, txSubmissionService) = buildNodeResources(config.nodeConnection)
      submitTxService <- txSubmissionService
      stateSyncService <- syncService
      filterSyncService <- syncService
      walletStateContainer <- WalletStateContainer.Live(walletCreation.create(config.initialState))
      walletQueryStateService <- Resource.pure(
        new WalletQueryStateService.Live(walletStateContainer),
      )
      walletStateService <- Resource.pure(
        new WalletStateService.Live(walletQueryStateService),
      )
      walletFilterService <- buildWalletFilterService(filterSyncService)
      walletTxSubmissionService <- buildWalletTxSubmissionService(
        submitTxService,
        walletStateContainer,
      )
      walletBlockProcessingService <- buildWalletBlockProcessingService(
        stateSyncService,
        walletStateContainer,
      )
    } yield WalletDependencies(
      walletBlockProcessingService,
      walletStateService,
      walletFilterService,
      walletTxSubmissionService,
    )

    val allocatedWallet = dependencies.allocated.map((AllocatedWallet[F, TWallet] _).tupled)

    allocatedWallet.attemptTap {
      case Right(_) => builderTracer.walletBuildSuccess
      case Left(t)  => builderTracer.walletBuildError(t.getMessage)
    }
  }

  private type NodeResources[F[_]] =
    (Resource[F, SyncService[F]], Resource[F, TxSubmissionService[F]])

  private def buildNodeResources[F[_]: Async](nodeConnection: NodeConnection): NodeResources[F] =
    nodeConnection match {
      case NodeUri(uri) =>
        val syncService = SyncServiceFactory.fromMockedNodeClient[F](uri)
        val txSubmissionService = TxSubmissionServiceFactory.fromMockedNodeClient[F](uri)
        (syncService, txSubmissionService)
      case NodeInstance(nodeInstance) =>
        val syncService =
          Async[F].delay(SyncServiceFactory.fromNode[F](nodeInstance)).toResource
        val txSubmissionService =
          Async[F].delay(TxSubmissionServiceFactory.fromNode[F](nodeInstance)).toResource
        (syncService, txSubmissionService)
    }

  private def buildWalletBlockProcessingService[F[_]: Async, TWallet](
      syncService: SyncService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletBlockProcessing: WalletBlockProcessing[TWallet, Block],
  ): Resource[F, WalletBlockProcessingService[F]] = {
    implicit val walletBlockProcessingTracer: WalletBlockProcessingTracer[F] =
      WalletBlockProcessingTracer.from(rootTracer)
    WalletBlockProcessingService(syncService, walletStateContainer)
  }

  private def buildWalletFilterService[F[_]: Async](
      syncService: SyncService[F],
  )(implicit rootTracer: Tracer[F, StructuredLog]): Resource[F, WalletFilterService[F]] = {
    implicit val walletFilterTracer: WalletFilterTracer[F] = WalletFilterTracer.from(rootTracer)
    WalletFilterService.Live[F](syncService)
  }

  private def buildWalletTxSubmissionService[F[_]: Async, TWallet](
      submitTxService: TxSubmissionService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletTxBalancing: WalletTxBalancing[TWallet, mod.Transaction, mod.CoinInfo],
  ): Resource[F, WalletTxSubmissionService[F]] = {
    implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[F] =
      WalletTxSubmissionTracer.from(rootTracer)
    implicit val balanceTxTracer: BalanceTransactionTracer[F] =
      BalanceTransactionTracer.from(rootTracer)
    Resource.pure(
      new WalletTxSubmissionService.Live[F, TWallet](submitTxService, walletStateContainer),
    )
  }
}
