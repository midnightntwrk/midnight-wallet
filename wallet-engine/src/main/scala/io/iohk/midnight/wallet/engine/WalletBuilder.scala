package io.iohk.midnight.wallet.engine

import cats.Show
import cats.effect.IO
import cats.effect.Resource
import cats.effect.kernel.Async
import cats.effect.syntax.resource.*
import cats.syntax.all.*
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.engine.WalletBuilder.Config.Error.{InvalidLogLevel, InvalidUri}
import io.iohk.midnight.wallet.ouroboros
import io.iohk.midnight.wallet.ouroboros.network.JsonWebSocketClientTracer
import io.iohk.midnight.wallet.ouroboros.sync.OuroborosSyncService
import io.iohk.midnight.wallet.ouroboros.sync.tracing.OuroborosSyncTracer
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ouroboros.tx_submission.tracing.OuroborosTxSubmissionTracer
import io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer
import sttp.capabilities.WebSockets
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

object WalletBuilder {
  def build[F[_]: Async](
      config: Config,
  )(implicit
      rootTracer: Tracer[F, StructuredLog],
  ): Resource[F, (WalletState[F], WalletFilterService[F], WalletTxSubmission[F])] = {
    val sttpBackend = FetchCatsBackend[F]()
    val builderTracer = WalletBuilderTracer.from(rootTracer)
    val result = for {
      _ <- builderTracer.buildRequested(config).toResource
      submitTxService <- buildOuroborosTxSubmissionService(sttpBackend, config)
      stateSyncService <- buildOuroborosSyncService(sttpBackend, config)
      filterSyncService <- buildOuroborosSyncService(sttpBackend, config)
      walletState <- WalletState.Live[F](stateSyncService, config.initialState)
      walletFilterService <- Resource.pure(new WalletFilterService.Live[F](filterSyncService))
      balanceTransactionService <- Resource.pure(new BalanceTransactionService.Live[F]())
      walletTxSubmission <- Resource.pure(
        new WalletTxSubmission.Live[F](submitTxService, balanceTransactionService, walletState),
      )
    } yield (walletState, walletFilterService, walletTxSubmission)
    result.attemptTap {
      case Right(_) => builderTracer.walletBuildSuccess.toResource
      case Left(t)  => builderTracer.walletBuildError(t.getMessage).toResource
    }
  }

  private def buildOuroborosSyncService[F[_]: Async](
      sttpBackend: SttpBackend[F, WebSockets],
      config: Config,
  )(implicit rootTracer: Tracer[F, StructuredLog]): Resource[F, SyncService[F]] = {
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[F] =
      JsonWebSocketClientTracer.from(rootTracer)
    implicit val ogmiosSyncTracer: OuroborosSyncTracer[F] =
      OuroborosSyncTracer.from(rootTracer)

    import Instances.{blockDecoder, blockShow}

    ouroboros.network
      .SttpJsonWebSocketClient[F](sttpBackend, config.platformUri)
      .flatMap(OuroborosSyncService.apply[F, Block])
      .map { ogmiosSync => () => ogmiosSync.sync }
  }

  private def buildOuroborosTxSubmissionService[F[_]: Async](
      sttpBackend: SttpBackend[F, WebSockets],
      config: Config,
  )(implicit rootTracer: Tracer[F, StructuredLog]): Resource[F, TxSubmissionService[F]] = {
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[F] =
      JsonWebSocketClientTracer.from(rootTracer)
    implicit val ogmiosTxSubmissionTracer: OuroborosTxSubmissionTracer[F] =
      OuroborosTxSubmissionTracer.from(rootTracer)

    import Instances.{transactionEncoder, transactionShow}

    ouroboros.network
      .SttpJsonWebSocketClient[F](sttpBackend, config.platformUri)
      .flatMap(OuroborosTxSubmissionService(_))
      .map { ouroborosSubmitTxService => (transaction: Transaction) =>
        ouroborosSubmitTxService.submitTransaction(transaction).map {
          case SubmissionResult.Accepted =>
            TxSubmissionService.SubmissionResult.Accepted
          case SubmissionResult.Rejected(reason) =>
            TxSubmissionService.SubmissionResult.Rejected(reason)
        }
      }
  }

  def catsEffectWallet(
      config: Config,
  )(implicit
      rootTracer: Tracer[IO, StructuredLog],
  ): Resource[IO, (WalletState[IO], WalletFilterService[IO], WalletTxSubmission[IO])] = {
    build[IO](config)
  }

  def generateInitialState(): String =
    LedgerSerialization.serializeState(new ZSwapLocalState())

  final case class Config(platformUri: Uri, initialState: ZSwapLocalState, minLogLevel: LogLevel)

  object Config {
    def parse(
        nodeUri: String,
        initialState: Option[String],
        minLogLevel: Option[String],
    ): Either[Throwable, Config] = for {
      parsedUri <- Uri.parse(nodeUri).leftMap(InvalidUri)
      parsedLogLevel <- parseLogLevel(minLogLevel)
      parsedInitialState <- parseInitialState(initialState)
    } yield new Config(parsedUri, parsedInitialState, parsedLogLevel)

    implicit val configShow: Show[Config] = Show.fromToString

    private def parseInitialState(
        maybeInitialState: Option[String],
    ): Either[Throwable, ZSwapLocalState] = {
      maybeInitialState.map(LedgerSerialization.parseState).getOrElse(Right(new ZSwapLocalState()))
    }

    private def parseLogLevel(maybeLogLevel: Option[String]): Either[Throwable, LogLevel] = {
      maybeLogLevel match {
        case Some(providedLogLevel) =>
          LogLevel
            .fromString(providedLogLevel)
            .toRight[Throwable](InvalidLogLevel(s"Invalid log level: $providedLogLevel"))
        case None =>
          Right(LogLevel.Warn)
      }
    }

    abstract class Error(msg: String) extends Exception(msg)
    object Error {
      final case class InvalidUri(msg: String) extends Error(msg)
      final case class InvalidLogLevel(msg: String) extends Error(msg)
    }
  }
}
