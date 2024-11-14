package io.iohk.midnight.wallet.engine.js

import cats.effect.{Async, Resource}
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap
import sttp.model.Uri

object ProvingServiceFactory {

  def apply[
      F[_]: Async,
      UnprovenTransaction: zswap.UnprovenTransaction.IsSerializable,
      Transaction: zswap.Transaction.IsSerializable,
  ](
      provingServerUri: Uri,
  )(using
      ProtocolVersion,
      zswap.NetworkId,
  ): Resource[F, ProvingService[F, UnprovenTransaction, Transaction]] =
    ProverClient(provingServerUri).map(proverClient => proverClient.proveTransaction(_))

}
