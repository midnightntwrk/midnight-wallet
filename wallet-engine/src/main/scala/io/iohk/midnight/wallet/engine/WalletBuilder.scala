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
    val rootTracer = ConsoleTracer.contextAware[F, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    val dependencies = for {
      _ <- builderTracer.buildRequested(config).toResource
      (syncService, txSubmissionService) = buildNodeResources(config.nodeConnection, rootTracer)
      submitTxService <- txSubmissionService
      stateSyncService <- syncService
      filterSyncService <- syncService
      walletState <- WalletState.Live[F](stateSyncService, config.initialState)
      walletFilterService <- Resource.pure(new WalletFilterService.Live[F](filterSyncService))
      balanceTransactionService <- Resource.pure(new BalanceTransactionService.Live[F]())
      walletTxSubmission <- Resource.pure(
        new WalletTxSubmission.Live[F](submitTxService, balanceTransactionService, walletState),
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
      tracer: Tracer[F, StructuredLog],
  ): NodeResources[F] =
    nodeConnection match {
      case NodeUri(uri) =>
        val syncService = SyncServiceFactory.connect(uri, tracer)
        val txSubmissionService = TxSubmissionServiceFactory.connect(uri, tracer)
        (syncService, txSubmissionService)
      case NodeInstance(nodeInstance) =>
        val syncService =
          Async[F].delay(SyncServiceFactory.fromNode[F](nodeInstance)).toResource
        val txSubmissionService =
          Async[F].delay(TxSubmissionServiceFactory.fromNode[F](nodeInstance)).toResource
        (syncService, txSubmissionService)
    }
}
