package io.iohk.midnight.wallet

import cats.effect.kernel.Async
import cats.effect.std.{Console, Random}
import cats.effect.{IO, Resource}
import io.iohk.midnight.wallet.clients.lares.LaresClient
import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.clients.prover.ProverClient
import io.iohk.midnight.wallet.services.*
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

object WalletBuilder {
  def build[F[_]: Async: Console](config: Config): Resource[F, Wallet[F]] = {
    val sttpBackend = FetchCatsBackend[F]()
    val proverClient = new ProverClient.Live[F](sttpBackend, config.proverUri)
    val proverService = new ProverService.Live[F](proverClient, config.proverMaxRetries)

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
      proverMaxRetries: Int,
      syncBufferSize: Int,
      userIdLength: Int,
  )

  object Config {
    def default(proverUri: Uri, platformUri: Uri, laresUri: Uri): Config =
      Config(
        proverUri,
        platformUri,
        laresUri,
        proverMaxRetries = 2000,
        syncBufferSize = 10,
        userIdLength = 10,
      )
  }
}
