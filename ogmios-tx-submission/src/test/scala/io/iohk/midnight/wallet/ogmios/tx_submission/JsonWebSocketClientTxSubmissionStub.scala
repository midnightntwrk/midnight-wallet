package io.iohk.midnight.wallet.ogmios.tx_submission

import cats.Show
import cats.effect.IO
import cats.effect.std.Queue
import cats.syntax.all.*
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.ogmios.tx_submission.JsonWebSocketClientTxSubmissionStub.rejectDetails
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Receive
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Receive.{
  AcceptTx,
  RejectTx,
  RejectTxDetails,
}
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Send.SubmitTx
import io.iohk.midnight.wallet.blockchain.util.implicits.Equality.*
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClient

class JsonWebSocketClientTxSubmissionStub(responses: Queue[IO, Receive])
    extends JsonWebSocketClient[IO] {

  override def send[T: Encoder](message: T): IO[Unit] =
    message match {
      case SubmitTx(transaction) =>
        if (isValid(transaction)) responses.offer(AcceptTx)
        else responses.offer(RejectTx(rejectDetails))

      case msg =>
        implicit val show: Show[T] = Show.fromToString
        new Exception(s"Unexpected message ${msg.show}").raiseError[IO, Unit]
    }

  // We don't have a real validation logic, currently all transactions
  // are valid. So let's pretend that only the example call tx is invalid
  // for the sake of testing
  private def isValid(transaction: Transaction): Boolean =
    transaction === examples.SubmitTx.validCallTx

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  override def receive[T: Decoder](): IO[T] =
    responses.take.map(_.asInstanceOf[T])
}

object JsonWebSocketClientTxSubmissionStub {
  def apply(initialResponses: Seq[Receive] = Seq.empty): IO[JsonWebSocketClientTxSubmissionStub] =
    Queue
      .unbounded[IO, Receive]
      .flatTap(q => initialResponses.traverse(q.offer))
      .map(new JsonWebSocketClientTxSubmissionStub(_))

  val rejectDetails: RejectTxDetails.Other = RejectTxDetails.Other("Invalid")
}
