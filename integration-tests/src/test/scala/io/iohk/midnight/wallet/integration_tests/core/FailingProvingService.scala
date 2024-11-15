package io.iohk.midnight.wallet.integration_tests.core

import cats.effect.IO
import cats.syntax.applicativeError.*
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.core.services.ProvingService

class FailingProvingService extends ProvingService[UnprovenTransaction, Transaction] {
  override def proveTransaction(tx: UnprovenTransaction): IO[Transaction] =
    Exception("Failing stub").raiseError
}
