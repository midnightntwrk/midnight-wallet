package io.iohk.midnight.wallet.services

import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage.LocalTxSubmission.SubmitTx
import io.iohk.midnight.wallet.domain.Transaction

trait PlatformService[F[_]] {
  def submitTransaction(transaction: Transaction): F[Unit]
}

object PlatformService {
  class Live[F[_]](platformClient: PlatformClient[F]) extends PlatformService[F] {
    override def submitTransaction(transaction: Transaction): F[Unit] =
      platformClient.send(SubmitTx(transaction))
  }
}
