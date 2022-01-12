package io.iohk.midnight.wallet.clients

import cats.Id
import io.iohk.midnight.wallet.domain.Transaction

class PlatformClientStub extends PlatformClient[Id]:
  override def submitTransaction(transaction: Transaction): Unit = ()
