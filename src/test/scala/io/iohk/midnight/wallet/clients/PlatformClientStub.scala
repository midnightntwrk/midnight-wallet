package io.iohk.midnight.wallet.clients

import cats.effect.SyncIO
import io.iohk.midnight.wallet.domain.Transaction

class PlatformClientStub extends PlatformClient[SyncIO]:
  override def submitTransaction(transaction: Transaction): SyncIO[Unit] = SyncIO.unit
