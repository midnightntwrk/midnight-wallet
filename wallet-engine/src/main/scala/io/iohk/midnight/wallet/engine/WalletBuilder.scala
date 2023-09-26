package io.iohk.midnight.wallet.engine

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.effect.syntax.resource.*
import cats.syntax.all.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.{
  WalletTransactionProcessingTracer,
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
  final case class WalletDependencies[F[_], TWallet](
      walletTransactionProcessingService: WalletTransactionProcessingService[F],
      walletStateService: WalletStateService[F, TWallet],
      walletTxSubmissionService: WalletTxSubmissionService[F],
      walletTransactionService: WalletTransactionService[F],
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
      walletCreation: WalletCreation[TWallet, zswap.LocalState],
      walletKeys: WalletKeys[TWallet, zswap.CoinPublicKey, zswap.EncryptionSecretKey],
      walletTransactionProcessing: WalletTransactionProcessing[TWallet, Transaction],
      walletTxBalancing: WalletTxBalancing[TWallet, zswap.Transaction, zswap.CoinInfo],
  ): F[AllocatedWallet[F, TWallet]] = {
    implicit val rootTracer: Tracer[F, StructuredLog] =
      ConsoleTracer.contextAware[F, StringLogContext](config.minLogLevel)
    val builderTracer = WalletBuilderTracer.from(rootTracer)

    val dependencies = for {
      _ <- builderTracer.buildRequested(config).toResource
      walletStateContainer <- WalletStateContainer.Live(walletCreation.create(config.initialState))
      walletQueryStateService <- Resource.pure(
        new WalletQueryStateService.Live(walletStateContainer),
      )
      walletStateService <- Resource.pure(
        new WalletStateService.Live(walletQueryStateService),
      )
      submitTxService <- TxSubmissionServiceFactory(config.substrateNodeUri)
      stateSyncService <- SyncServiceFactory(
        config.indexerUri,
        config.indexerWsUri,
        walletStateService,
      )
      provingService <- ProvingServiceFactory(config.provingServerUri)
      walletTxSubmissionService <- buildWalletTxSubmissionService(submitTxService)
      walletBlockProcessingService <- buildWalletTransactionProcessingService(
        stateSyncService,
        walletStateContainer,
      )
      walletTransactionService <- buildWalletTransactionService(
        walletStateContainer,
        provingService,
      )
    } yield WalletDependencies(
      walletBlockProcessingService,
      walletStateService,
      walletTxSubmissionService,
      walletTransactionService,
    )

    val allocatedWallet = dependencies.allocated.map((AllocatedWallet[F, TWallet] _).tupled)

    allocatedWallet.attemptTap {
      case Right(_) => builderTracer.walletBuildSuccess
      case Left(t)  => builderTracer.walletBuildError(t.getMessage)
    }
  }

  private def buildWalletTransactionProcessingService[F[_]: Async, TWallet](
      syncService: SyncService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
      walletTransactionProcessing: WalletTransactionProcessing[TWallet, Transaction],
  ): Resource[F, WalletTransactionProcessingService[F]] = {
    implicit val walletTransactionProcessingTracer: WalletTransactionProcessingTracer[F] =
      WalletTransactionProcessingTracer.from(rootTracer)
    WalletTransactionProcessingService(syncService, walletStateContainer)
  }

  private def buildWalletTxSubmissionService[F[_]: Async, TWallet](
      submitTxService: TxSubmissionService[F],
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
  ): Resource[F, WalletTxSubmissionService[F]] = {
    implicit val walletTxSubmissionTracer: WalletTxSubmissionTracer[F] =
      WalletTxSubmissionTracer.from(rootTracer)
    Resource.pure(
      new WalletTxSubmissionService.Live[F, TWallet](submitTxService),
    )
  }

  private def buildWalletTransactionService[F[_]: Async, TWallet](
      walletStateContainer: WalletStateContainer[F, TWallet],
      provingService: ProvingService[F],
  )(implicit
      walletTxBalancing: WalletTxBalancing[TWallet, zswap.Transaction, zswap.CoinInfo],
  ): Resource[F, WalletTransactionService[F]] = {
    Resource.pure(new WalletTransactionService.Live(walletStateContainer, provingService))
  }
}
