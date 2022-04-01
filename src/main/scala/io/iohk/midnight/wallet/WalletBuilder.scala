package io.iohk.midnight.wallet

import cats.effect.kernel.Async
import cats.effect.std.Random
import cats.effect.{IO, Resource}
import io.iohk.midnight.wallet.clients.lares.LaresClient
import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.clients.prover.ProverClient
import io.iohk.midnight.wallet.services.*
import io.iohk.midnight.wallet.js.JSLogging.*
import org.scalajs.dom.RequestCredentials
import org.typelevel.log4cats.Logger
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import sttp.client3.FetchOptions

object WalletBuilder {
  def build[F[_]: Async: Logger](config: Config): Resource[F, Wallet[F]] = {
    val fetchOptions =
      if (config.includeCookies)
        FetchOptions.Default.copy(credentials = Some(RequestCredentials.include))
      else
        FetchOptions.Default
    val sttpBackend = FetchCatsBackend[F](fetchOptions)
    val proverClient = new ProverClient.Live[F](sttpBackend, config.proverUri)
    val proverService =
      new ProverService.Live[F](proverClient, config.proverMaxRetries, config.proverRetryDelay)

    Resource.eval(Random.scalaUtilRandom[F]).flatMap { implicit random =>
      for {
        platformClient <- PlatformClient.Live[F](sttpBackend, config.platformUri)
        syncService <- SyncService.Live[F](platformClient, config.syncBufferSize)
        userId <- Resource.eval(UserIdGenerator.generate(config.userIdLength))
        laresClient = LaresClient.Live[F](sttpBackend, config.laresUri)
        laresService = new LaresService.Live[F](userId, laresClient)
      } yield {
        new Wallet.Live[F](proverService, syncService, laresService, userId)
      }
    }
  }

  def catsEffectWallet(config: Config): Resource[IO, Wallet[IO]] = build[IO](config)

  final case class Config(
      proverUri: Uri,
      platformUri: Uri,
      laresUri: Uri,
      includeCookies: Boolean,
      proverMaxRetries: Int,
      proverRetryDelay: FiniteDuration,
      syncBufferSize: Int,
      userIdLength: Int,
  )

  object Config {
    def default(proverUri: Uri, platformUri: Uri, laresUri: Uri, includeCookies: Boolean): Config =
      Config(
        proverUri,
        platformUri,
        laresUri,
        includeCookies,
        proverMaxRetries = 20,
        proverRetryDelay = 1.second,
        syncBufferSize = 10,
        userIdLength = 10,
      )
  }
}
