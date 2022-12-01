package io.iohk.midnight.wallet.ogmios.tx_submission

import cats.Show
import cats.effect.std.{Queue, Semaphore}
import cats.effect.syntax.spawn.*
import cats.effect.{Deferred, GenConcurrent, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClient
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.Error.{
  DeferredFailed,
  EmptyPendingSubmissions,
}
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService.{
  GenConcurrentThrow,
  SubmissionResult,
}
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.Decoders.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.Encoders.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Send.SubmitTx
import io.iohk.midnight.wallet.ogmios.tx_submission.tracing.OgmiosTxSubmissionTracer

/** Implementation of the TxSubmissionService
  *
  * @param webSocketClient
  *   The low-level node client which allows for simple send and receive semantics through
  *   websockets
  * @param pendingSubmissions
  *   Transactions that were submitted but haven't received a response. The protocol should respond
  *   in the same order as transactions are submitted, so a Queue is enough
  * @param semaphore
  *   Needed to make tx submission and enqueuing pending request atomic
  */
class OgmiosTxSubmissionService[F[_]: GenConcurrentThrow](
    webSocketClient: JsonWebSocketClient[F],
    pendingSubmissions: Queue[F, Deferred[F, SubmissionResult]],
    semaphore: Semaphore[F],
)(implicit tracer: OgmiosTxSubmissionTracer[F]) {

  def submitTransaction(transaction: Transaction): F[SubmissionResult] =
    for {
      // To ensure the correct response is given to the corresponding submission request,
      // the send to node and the queue of the request must be done 1 fiber at a time,
      // so we use a semaphore with 1 permit
      _ <- semaphore.acquire
      deferred <- Deferred.apply[F, SubmissionResult]
      _ <- pendingSubmissions.offer(deferred)
      _ <- webSocketClient.send[LocalTxSubmission.Send](SubmitTx(transaction))
      _ <- tracer.txSubmitted(transaction)
      _ <- semaphore.release
      submissionResult <- deferred.get
      _ <- tracer.resultReceived(transaction, submissionResult)
    } yield submissionResult

  /** In case of exception, this loop will terminate. */
  private val loopReceive: F[Unit] =
    webSocketClient
      .receive[LocalTxSubmission.Receive]()
      .flatMap {
        case LocalTxSubmission.Receive.AcceptTx =>
          tryCompleteWith(SubmissionResult.Accepted)
        case LocalTxSubmission.Receive.RejectTx(details) =>
          tryCompleteWith(SubmissionResult.Rejected(details.reason))
      }
      .onError(tracer.processingMsgFailed)
      .foreverM

  private def tryCompleteWith(response: SubmissionResult): F[Unit] =
    pendingSubmissions.tryTake.flatMap {
      case Some(deferred) =>
        deferred
          .complete(response)
          .ifM(
            ().pure,
            // $COVERAGE-OFF$
            DeferredFailed(response).raiseError.void,
            // $COVERAGE-ON$
          )
      case None =>
        EmptyPendingSubmissions(response).raiseError.void
    }
}

object OgmiosTxSubmissionService {
  type GenConcurrentThrow[F[_]] = GenConcurrent[F, Throwable]

  sealed trait SubmissionResult
  object SubmissionResult {
    case object Accepted extends SubmissionResult
    final case class Rejected(reason: String) extends SubmissionResult
  }

  def apply[F[_]: GenConcurrentThrow](
      webSocketClient: JsonWebSocketClient[F],
  )(implicit tracer: OgmiosTxSubmissionTracer[F]): Resource[F, OgmiosTxSubmissionService[F]] = {
    // For the pending submissions an unbounded queue is fine because it's up
    // to the client to decide if it wants to fill up the memory with these requests.
    val submissionsQueue = Queue.unbounded[F, Deferred[F, SubmissionResult]]

    val semaphore = Semaphore[F](1)

    val instance =
      (submissionsQueue, semaphore).mapN(new OgmiosTxSubmissionService[F](webSocketClient, _, _))

    Resource.eval(instance).flatTap(_.loopReceive.background)
  }

  sealed abstract class Error(message: String) extends Exception(message)

  object Error {
    implicit val showSubmissionResponse: Show[SubmissionResult] =
      Show.fromToString[SubmissionResult]

    final case class EmptyPendingSubmissions(response: SubmissionResult)
        extends Error(s"${response.show} was received but no request was pending")

    final case class DeferredFailed(response: SubmissionResult)
        extends Error(s"Deferred fail to complete for ${response.show}")
  }
}
