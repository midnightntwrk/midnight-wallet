package io.iohk.midnight.wallet.clients

import cats.effect.SyncIO
import io.iohk.midnight.wallet.clients.FailingPlatformClient.PlatformClientError
import io.iohk.midnight.wallet.domain.{Hash, Transaction}

class PlatformClientStub(private var submittedTransactions: Set[Hash] = Set.empty)
    extends PlatformClient[SyncIO]:
  override def submitTransaction(transaction: Transaction): SyncIO[Unit] =
    SyncIO(submittedTransactions += transaction.hash)

  def wasSubmitted(hash: Hash): Boolean = submittedTransactions.contains(hash)
class FailingPlatformClient extends PlatformClient[SyncIO]:
  override def submitTransaction(transaction: Transaction): SyncIO[Unit] =
    SyncIO.raiseError(PlatformClientError)

object FailingPlatformClient:
  val PlatformClientError = new Exception("FailingPlatformClient")
