package io.iohk.midnight.wallet.integration_tests.core

import cats.ApplicativeThrow
import cats.syntax.applicativeError.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.midnightNtwrkZswap.mod.*

class FailingProvingService[F[_]: ApplicativeThrow]
    extends ProvingService[F, UnprovenTransaction, Transaction] {
  override def proveTransaction(tx: UnprovenTransaction): F[Transaction] =
    Exception("Failing stub").raiseError
}
