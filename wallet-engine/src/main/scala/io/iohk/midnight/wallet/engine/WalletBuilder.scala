package io.iohk.midnight.wallet.engine

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.effect.syntax.resource.*
import cats.syntax.all.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.engine.config.NodeConnection.{NodeInstance, NodeUri}
import io.iohk.midnight.wallet.engine.config.{Config, NodeConnection}
import io.iohk.midnight.wallet.engine.js.{SyncServiceFactory, TxSubmissionServiceFactory}
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.wallet.core.tracing.WalletStateTracer
import io.iohk.midnight.wallet.core.tracing.WalletFilterTracer
import io.iohk.midnight.wallet.core.tracing.BalanceTransactionTracer
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionTracer

object WalletBuilder {
  final case class WalletDependencies[F[_]](
      state: WalletState[F],
      filterService: WalletFilterService[F],
      txSubmissionService: WalletTxSubmission[F],
  )
  final case class AllocatedWallet[F[_]](
      dependencies: WalletDependencies[F],
      finalizer: F[Unit],
  )

  def build[F[_]: Async](config: Config): F[AllocatedWallet[F]] = {
    implicit val rootTracer: Tracer[F, StructuredLog] =
      ConsoleTracer.contextAware[F, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    val dependencies = for {
      _ <- builderTracer.buildRequested(config).toResource
      (syncService, txSubmissionService) = buildNodeResources(config.nodeConnection)
      submitTxService <- txSubmissionService
      stateSyncService <- syncService
      filterSyncService <- syncService
      walletState <- buildWalletState(stateSyncService, config.initialState)
      walletFilterService <- buildWalletFilterService(filterSyncService)
      balanceTxService <- buildBalanceTransactionService
      walletTxSubmission <- buildWalletTxSubmissionService(
        submitTxService,
        balanceTxService,
        walletState,
      )
    } yield WalletDependencies(walletState, walletFilterService, walletTxSubmission)

    val allocatedWallet = dependencies.allocated.map((AllocatedWallet[F] _).tupled)

    allocatedWallet.attemptTap {
      case Right(_) => builderTracer.walletBuildSuccess
      case Left(t)  => builderTracer.walletBuildError(t.getMessage)
    }
  }

  private type NodeResources[F[_]] =
    (Resource[F, SyncService[F]], Resource[F, TxSubmissionService[F]])

  private def buildNodeResources[F[_]: Async](
      nodeConnection: NodeConnection,
  )(implicit rootTracer: Tracer[F, StructuredLog]): NodeResources[F] =
    nodeConnection match {
      case NodeUri(uri) =>
        val syncService = SyncServiceFactory.connect(uri, rootTracer)
        val txSubmissionService = TxSubmissionServiceFactory.connect(uri, rootTracer)
        (syncService, txSubmissionService)
      case NodeInstance(nodeInstance) =>
        val syncService =
          Async[F].delay(SyncServiceFactory.fromNode[F](nodeInstance)).toResource
        val txSubmissionService =
          Async[F].delay(TxSubmissionServiceFactory.fromNode[F](nodeInstance)).toResource
        (syncService, txSubmissionService)
    }

  private def buildWalletState[F[_]: Async](
      syncService: SyncService[F],
      initialState: ZSwapLocalState,
  )(implicit rootTracer: Tracer[F, StructuredLog]): Resource[F, WalletState[F]] = {
    implicit val walletStateTracer: WalletStateTracer[F] = WalletStateTracer.from(rootTracer)
    WalletState.Live[F](syncService, initialState)
  }

  private def buildWalletFilterService[F[_]: Async](
      syncService: SyncService[F],
  )(implicit rootTracer: Tracer[F, StructuredLog]): Resource[F, WalletFilterService[F]] = {
    implicit val walletFilterTracer: WalletFilterTracer[F] = WalletFilterTracer.from(rootTracer)
    Resource.pure(new WalletFilterService.Live[F](syncService))
  }

  private def buildBalanceTransactionService[F[_]: Async](implicit
      rootTracer: Tracer[F, StructuredLog],
  ): Resource[F, BalanceTransactionService[F]] = {
    implicit val balanceTxTracer: BalanceTransactionTracer[F] =
      BalanceTransactionTracer.from(rootTracer)
    Resource.pure(new BalanceTransactionService.Live[F]())
  }

  private def buildWalletTxSubmissionService[F[_]: Async](
      submitTxService: TxSubmissionService[F],
      balanceTxService: BalanceTransactionService[F],
      walletState: WalletState[F],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
  ): Resource[F, WalletTxSubmission[F]] = {
    implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[F] =
      WalletTxSubmissionTracer.from(rootTracer)
    Resource.pure(
      new WalletTxSubmission.Live[F](submitTxService, balanceTxService, walletState),
    )
  }
}
