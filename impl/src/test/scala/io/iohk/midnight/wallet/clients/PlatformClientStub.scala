package io.iohk.midnight.wallet.clients

import cats.effect.SyncIO
import io.iohk.midnight.wallet.clients.FailingPlatformClient.PlatformClientError
import io.iohk.midnight.wallet.domain.*

class PlatformClientStub(
    private var submittedCallTransactions: Set[CallTransaction.Hash] = Set.empty,
    private var submittedDeployTransactions: Set[DeployTransaction.Hash] = Set.empty,
) extends PlatformClient[SyncIO]:
  override def submitTransaction(transaction: Transaction): SyncIO[Unit] =
    SyncIO {
      transaction match
        case call: CallTransaction     => submittedCallTransactions += call.hash
        case deploy: DeployTransaction => submittedDeployTransactions += deploy.hash
    }

  def wasCallTxSubmitted(hash: CallTransaction.Hash): Boolean =
    submittedCallTransactions.contains(hash)

  def wasDeployTxSubmitted(hash: DeployTransaction.Hash): Boolean =
    submittedDeployTransactions.contains(hash)

class FailingPlatformClient extends PlatformClient[SyncIO]:
  override def submitTransaction(transaction: Transaction): SyncIO[Unit] =
    SyncIO.raiseError(PlatformClientError)

object FailingPlatformClient:
  val PlatformClientError = new Exception("FailingPlatformClient")
