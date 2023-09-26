package io.iohk.midnight.wallet.engine.js

import cats.effect.{Async, Resource}
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap.{Offer, Transaction, UnprovenOffer, UnprovenTransaction}
import sttp.model.Uri

object ProvingServiceFactory {

  def apply[F[_]: Async](provingServerUri: Uri): Resource[F, ProvingService[F]] = {
    ProverClient(provingServerUri).map { proverClient =>
      new ProvingService[F]:
        override def proveTransaction(tx: UnprovenTransaction): F[Transaction] =
          proverClient.proveTransaction(tx)

        override def proveOffer(offer: UnprovenOffer): F[Offer] =
          proverClient.proveOffer(offer)
    }
  }

}
