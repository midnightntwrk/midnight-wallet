package io.iohk.midnight.wallet.engine

import cats.effect.kernel.Async
import cats.effect.std.Random
import cats.effect.{IO, Resource}
import cats.syntax.functor.*
import io.iohk.midnight.tracer.logging.ConsoleTracer
import io.iohk.midnight.wallet.blockchain.data.{Block, Transaction}
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService
import io.iohk.midnight.wallet.core.clients.prover.ProverClient
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.ogmios
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService
import org.scalajs.dom.RequestCredentials
import sttp.client3.FetchOptions
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

import scala.concurrent.duration.{DurationInt, FiniteDuration}

object WalletBuilder {
  def build[F[_]: Async](config: Config): Resource[F, Wallet[F]] = {
    val fetchOptions =
      if (config.includeCookies)
        FetchOptions.Default.copy(credentials = Some(RequestCredentials.include))
      else
        FetchOptions.Default
    val sttpBackend = FetchCatsBackend[F](fetchOptions)
    val proverClient = new ProverClient.Live[F](sttpBackend, config.proverUri)
    val proverService =
      new ProverService.Live[F](proverClient, config.proverMaxRetries, config.proverRetryDelay)

    implicit val clientTracer: ogmios.tracer.ClientRequestResponseTracer[F] = ConsoleTracer.apply

    Resource.eval(Random.scalaUtilRandom[F]).flatMap { implicit random =>
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
      } yield {
        new Wallet.Live[F](proverService, submitTxService, syncService)
      }
    }
  }

  def catsEffectWallet(config: Config): Resource[IO, Wallet[IO]] = build[IO](config)

  final case class Config(
      proverUri: Uri,
      platformUri: Uri,
      includeCookies: Boolean,
      proverMaxRetries: Int,
      proverRetryDelay: FiniteDuration,
      syncBufferSize: Int,
      userIdLength: Int,
  )

  object Config {
    def default(proverUri: Uri, nodeUri: Uri, includeCookies: Boolean): Config =
      Config(
        proverUri,
        nodeUri,
        includeCookies,
        proverMaxRetries = 20,
        proverRetryDelay = 1.second,
        syncBufferSize = 10,
        userIdLength = 10,
      )
  }
}
