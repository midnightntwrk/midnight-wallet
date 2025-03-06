package io.iohk.midnight.wallet.engine.js

import cats.effect.{IO, Resource}
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.prover.ProverClient
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import sttp.model.Uri

object ProvingServiceFactory {

  def apply[
      UnprovenTransaction: zswap.UnprovenTransaction.IsSerializable,
      Transaction: zswap.Transaction.IsSerializable,
  ](
      provingServerUri: Uri,
  )(using
      ProtocolVersion,
      zswap.NetworkId,
      Tracer[IO, StructuredLog],
  ): Resource[IO, ProvingService[UnprovenTransaction, Transaction]] =
    ProverClient(provingServerUri).map(proverClient => proverClient.proveTransaction(_))

}
