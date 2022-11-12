package io.iohk.midnight.wallet.engine

import cats.effect.kernel.Async
import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.{ConsoleTracer, ContextAwareLog}
import io.iohk.midnight.wallet.blockchain.data.{Block, Transaction}
import io.iohk.midnight.wallet.core.{LedgerSerialization, Wallet}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.engine.WalletBuilder.Config.Error.InvalidUri
import io.iohk.midnight.wallet.ogmios
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClientTracer
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService
import io.iohk.midnight.wallet.ogmios.sync.tracing.OgmiosSyncTracer
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ogmios.tx_submission.tracing.OgmiosTxSubmissionTracer
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri
import typings.midnightLedger.mod.ZSwapLocalState

object WalletBuilder {
  def build[F[_]: Async](config: Config): Resource[F, Wallet[F]] = {
    val sttpBackend = FetchCatsBackend[F]()

    implicit val contextAwareLogTracer: Tracer[F, ContextAwareLog] = ConsoleTracer.contextAware
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[F] =
      JsonWebSocketClientTracer.from(contextAwareLogTracer)
    implicit val ogmiosSyncTracer: OgmiosSyncTracer[F] =
      OgmiosSyncTracer.from(contextAwareLogTracer)
    implicit val ogmiosTxSubmissionTracer: OgmiosTxSubmissionTracer[F] =
      OgmiosTxSubmissionTracer.from(contextAwareLogTracer)

    for {
      txSubmissionWSClient <- ogmios.network
        .SttpJsonWebSocketClient[F](sttpBackend, config.platformUri)
      ogmiosSubmitTxService <- OgmiosTxSubmissionService(txSubmissionWSClient)
      submitTxService = new TxSubmissionService[F] {
        override def submitTransaction(
            transaction: Transaction,
        ): F[TxSubmissionService.SubmissionResult] =
          ogmiosSubmitTxService.submitTransaction(transaction).map {
            case SubmissionResult.Accepted => TxSubmissionService.SubmissionResult.Accepted
            case SubmissionResult.Rejected(reason) =>
              TxSubmissionService.SubmissionResult.Rejected(reason)
          }
      }
      syncWSClient <- ogmios.network.SttpJsonWebSocketClient[F](sttpBackend, config.platformUri)
      ogmiosSyncService = OgmiosSyncService(syncWSClient)
      syncService = new SyncService[F] {
        override def sync(): fs2.Stream[F, Block] = ogmiosSyncService.sync()
      }
      wallet <- Resource.eval(Wallet.Live[F](submitTxService, syncService, config.initialState))
    } yield wallet
  }

  def catsEffectWallet(config: Config): Resource[IO, Wallet[IO]] = build[IO](config)

  def generateInitialState(): String =
    LedgerSerialization.serializeState(new ZSwapLocalState())

  final case class Config(platformUri: Uri, initialState: ZSwapLocalState)

  object Config {
    def parse(nodeUri: String, initialState: Option[String]): Either[Throwable, Config] =
      Uri
        .parse(nodeUri)
        .leftMap(InvalidUri.apply)
        .flatMap { uri =>
          initialState
            .map(LedgerSerialization.parseState)
            .getOrElse(Right(new ZSwapLocalState()))
            .map(new Config(uri, _))
        }

    abstract class Error(msg: String) extends Exception(msg)
    object Error {
      final case class InvalidUri(msg: String) extends Error(msg)
    }
  }
}
