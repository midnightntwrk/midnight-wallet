package io.iohk.midnight.wallet.integration_tests.core

import cats.ApplicativeThrow
import cats.syntax.applicativeError.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.zswap

class FailingProvingService[F[_]: ApplicativeThrow] extends ProvingService[F] {
  override def proveTransaction(tx: zswap.UnprovenTransaction): F[zswap.Transaction] =
    Exception("Failing stub").raiseError
}
