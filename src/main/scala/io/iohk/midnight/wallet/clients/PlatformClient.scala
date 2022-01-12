package io.iohk.midnight.wallet.clients

import io.iohk.midnight.wallet.domain.*

trait PlatformClient[F[_]]:
  def submitTransaction(transaction: Transaction): F[Unit]
