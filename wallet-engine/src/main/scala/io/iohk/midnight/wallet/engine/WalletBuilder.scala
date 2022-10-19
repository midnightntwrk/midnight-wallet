package io.iohk.midnight.wallet.engine

import cats.effect.kernel.Async
import cats.effect.{IO, Resource}
import cats.syntax.functor.*
import io.iohk.midnight.tracer.logging.ConsoleTracer
import io.iohk.midnight.wallet.blockchain.data.{Block, Transaction}
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.ogmios
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

object WalletBuilder {
  def build[F[_]: Async](config: Config): Resource[F, Wallet[F]] = {
    val sttpBackend = FetchCatsBackend[F]()

    implicit val clientTracer: ogmios.tracer.ClientRequestResponseTracer[F] = ConsoleTracer.apply

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
      new Wallet.Live[F](submitTxService, syncService)
    }
  }

  def catsEffectWallet(config: Config): Resource[IO, Wallet[IO]] = build[IO](config)

  final case class Config(
      platformUri: Uri,
      syncBufferSize: Int,
      userIdLength: Int,
  )

  object Config {
    def default(nodeUri: Uri): Config =
      Config(
        nodeUri,
        syncBufferSize = 10,
        userIdLength = 10,
      )
  }
}
