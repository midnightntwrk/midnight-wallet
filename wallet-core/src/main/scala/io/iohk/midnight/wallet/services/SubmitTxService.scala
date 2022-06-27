package io.iohk.midnight.wallet.services

import cats.Show
import cats.effect.kernel.GenConcurrent
import cats.effect.std.{Queue, Semaphore}
import cats.effect.syntax.spawn.*
import cats.effect.{Deferred, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage.LocalTxSubmission.SubmitTx
import io.iohk.midnight.wallet.domain.Transaction
import io.iohk.midnight.wallet.services.SubmitTxService.Error.{
  DeferredFailed,
  EmptyPendingSubmissions,
  UnexpectedMessageReceived,
}
import io.iohk.midnight.wallet.services.SubmitTxService.SubmissionResponse
import io.iohk.midnight.wallet.services.SubmitTxService.SubmissionResponse.{Accepted, Rejected}
import org.typelevel.log4cats.Logger

trait SubmitTxService[F[_]] {
  def submitTransaction(transaction: Transaction): F[SubmissionResponse]
}

object SubmitTxService {
  type GenConcurrentThrow[F[_]] = GenConcurrent[F, Throwable]

  /** Implementation of the SyncService
    *
    * @param platformClient
    *   The low-level platform client which allows for simple send and receive semantics through
    *   websockets
    * @param pendingSubmissions
    *   Transactions that were submitted but haven't received a response. The protocol should
    *   respond in the same order as transactions are submitted, so a Queue is enough
    * @param semaphore
    *   Needed to make tx submission and enqueuing pending request atomic
    */
  class Live[F[_]: GenConcurrentThrow: Logger](
      platformClient: PlatformClient[F],
      pendingSubmissions: Queue[F, Deferred[F, SubmissionResponse]],
      semaphore: Semaphore[F],
  ) extends SubmitTxService[F] {
    override def submitTransaction(transaction: Transaction): F[SubmissionResponse] =
      for {
        // To ensure the correct response is given to the corresponding submission request,
        // the send to platform and the queue of the request must be done 1 fiber at a time,
        // so we use a semaphore with 1 permit
        _ <- semaphore.acquire
        _ <- platformClient.send(SubmitTx(transaction))
        deferred <- Deferred.apply[F, SubmissionResponse]
        _ <- pendingSubmissions.offer(deferred)
        _ <- semaphore.release
        result <- deferred.get
      } yield result

    private val loopReceive: F[Unit] =
      platformClient
        .receive()
        .flatMap(processReceivedMessage)
        .attempt
        .map(_.leftMap(error => Logger[F].error(error.getMessage)))
        .foreverM

    private def processReceivedMessage(message: ReceiveMessage): F[Unit] =
      message match {
        case LocalTxSubmission.AcceptTx          => completeWith(Accepted)
        case LocalTxSubmission.RejectTx(details) => completeWith(Rejected(details.reason))
        case other                               => UnexpectedMessageReceived(other).raiseError
      }

    private def completeWith(response: SubmissionResponse): F[Unit] =
      pendingSubmissions.tryTake.flatMap {
        case Some(deferred) =>
          deferred.complete(response).ifM(().pure, DeferredFailed(response).raiseError)
        case None =>
          EmptyPendingSubmissions(response).raiseError
      }
  }

  object Live {
    def apply[F[_]: GenConcurrentThrow: Logger](
        platformClient: PlatformClient[F],
    ): Resource[F, Live[F]] = {
      // For the pending submissions an unbounded queue is fine because it's up
      // to the client to decide if it wants to fill up the memory with these requests.
      val submissionsQueue = Queue.unbounded[F, Deferred[F, SubmissionResponse]]

      val semaphore = Semaphore[F](1)

      val instance = (submissionsQueue, semaphore)
        .mapN(new Live[F](platformClient, _, _))

      Resource.eval(instance).flatTap(_.loopReceive.background)
    }
  }

  sealed trait SubmissionResponse
  object SubmissionResponse {
    case object Accepted extends SubmissionResponse
    final case class Rejected(reason: String) extends SubmissionResponse

    implicit val showSubmissionResponse: Show[SubmissionResponse] =
      Show.fromToString[SubmissionResponse]
  }

  sealed abstract class Error(message: String) extends Exception(message)
  object Error {
    final case class UnexpectedMessageReceived(message: ReceiveMessage)
        extends Error(s"Unexpected message received: ${message.show}")
    final case class EmptyPendingSubmissions(response: SubmissionResponse)
        extends Error(s"${response.show} was received but no request was pending")
    final case class DeferredFailed(response: SubmissionResponse)
        extends Error(s"Deferred fail to complete for ${response.show}")
  }
}
