package io.iohk.midnight.wallet

import cats.effect.kernel.Async
import cats.effect.std.Random
import cats.effect.{IO, Resource}
import cats.syntax.functor.*
import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.clients.prover.ProverClient
import io.iohk.midnight.wallet.services.{ProverService, SyncService}
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

object WalletBuilder {
  def build[F[_]: Async](
      proverUri: Uri,
      platformUri: Uri,
  ): Resource[F, Wallet[F]] = {
    val sttpBackend = FetchCatsBackend[F]()
    val proverClient = new ProverClient.Live[F](sttpBackend, proverUri)
    val proverService = new ProverService.Live[F](proverClient, 5)

    PlatformClient
      .Live[F](sttpBackend, platformUri)
      .flatMap(SyncService.Live[F](_, 100))
      .evalMap { syncService =>
        Random
          .scalaUtilRandom[F]
          .map { implicit random =>
            new Wallet.Live[F](proverService, syncService)
          }
      }
  }

  def catsEffectWallet(proverUri: Uri, platformUri: Uri): Resource[IO, Wallet[IO]] =
    build[IO](proverUri, platformUri)
}
