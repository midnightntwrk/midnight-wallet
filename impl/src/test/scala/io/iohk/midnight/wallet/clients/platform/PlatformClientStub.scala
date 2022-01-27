package io.iohk.midnight.wallet.clients.platform

import cats.syntax.applicativeError.*
import cats.effect.SyncIO
import io.iohk.midnight.wallet.clients.platform.FailingPlatformClient.PlatformClientError
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage.LocalTxSubmission.SubmitTx
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import io.iohk.midnight.wallet.domain.*

class PlatformClientStub(
    private var submittedCallTransactions: Set[Hash[CallTransaction]] = Set.empty,
    private var submittedDeployTransactions: Set[Hash[DeployTransaction]] = Set.empty,
) extends PlatformClient[SyncIO]:
  override def send(sendMessage: SendMessage): SyncIO[Unit] =
    SyncIO {
      sendMessage match
        case SubmitTx(call: CallTransaction)     => submittedCallTransactions += call.hash
        case SubmitTx(deploy: DeployTransaction) => submittedDeployTransactions += deploy.hash
        case _                                   =>
    }

  override def receive(): SyncIO[ReceiveMessage] = SyncIO.pure(LocalBlockSync.AwaitReply)

  def wasCallTxSubmitted(hash: Hash[CallTransaction]): Boolean =
    submittedCallTransactions.contains(hash)

  def wasDeployTxSubmitted(hash: Hash[DeployTransaction]): Boolean =
    submittedDeployTransactions.contains(hash)

class FailingPlatformClient extends PlatformClient[SyncIO]:
  override def send(sendMessage: SendMessage): SyncIO[Unit] =
    SyncIO.raiseError(PlatformClientError)

  override def receive(): SyncIO[ReceiveMessage] = PlatformClientError.raiseError

object FailingPlatformClient:
  val PlatformClientError = new Exception("FailingPlatformClient")
