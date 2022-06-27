package io.iohk.midnight.wallet.clients.platform

import cats.effect.IO
import cats.effect.std.Queue
import cats.implicits.toShow
import cats.syntax.applicativeError.*
import cats.syntax.eq.*
import io.iohk.midnight.wallet.clients.platform.PlatformClientStub.rejectDetails
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission.{
  AcceptTx,
  RejectTx,
  RejectTxDetails,
}
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage.LocalTxSubmission.SubmitTx
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.util.implicits.Equality.*

/** A dummy implementation of the platform client.
  * @param responses
  */
class PlatformClientStub(
    responses: Queue[IO, ReceiveMessage],
) extends PlatformClient[IO] {
  override def send(message: SendMessage): IO[Unit] =
    message match {
      case SubmitTx(transaction) =>
        if (isValid(transaction)) responses.offer(AcceptTx)
        else responses.offer(RejectTx(rejectDetails))

      case msg =>
        new Exception(s"Unexpected message ${msg.show}").raiseError[IO, Unit]
    }

  // We don't have a real validation logic, currently all transactions
  // are valid. So let's pretend that only the example call tx is invalid
  // for the sake of testing
  private def isValid(transaction: Transaction): Boolean =
    transaction === examples.SubmitTx.validCallTx

  override def receive(): IO[ReceiveMessage] =
    responses.take
}

object PlatformClientStub {
  def apply(): IO[PlatformClientStub] =
    Queue.unbounded[IO, ReceiveMessage].map(new PlatformClientStub(_))

  val rejectDetails: RejectTxDetails.Other = RejectTxDetails.Other("Invalid")
}
