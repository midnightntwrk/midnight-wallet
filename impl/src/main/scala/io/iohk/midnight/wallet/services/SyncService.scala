package io.iohk.midnight.wallet.services

import cats.effect.kernel.GenConcurrent
import cats.effect.std.{Queue, Semaphore}
import cats.effect.syntax.spawn.*
import cats.effect.{Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.clients.platform.PlatformClient
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.{
  LocalBlockSync,
  LocalTxSubmission,
}
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage.LocalTxSubmission.SubmitTx
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import io.iohk.midnight.wallet.domain.{Block, Transaction}
import io.iohk.midnight.wallet.services.SyncService.Error.{
  DeferredFailed,
  EmptyPendingSubmissions,
  UnexpectedMessageReceived,
}
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse.{Accepted, Rejected}

trait SyncService[F[_]] {
  def submitTransaction(transaction: Transaction): F[SubmissionResponse]

  def sync(): F[Stream[F, Block]]
}

object SyncService {
  type GenConcurrentThrow[F[_]] = GenConcurrent[F, Throwable]

  /** Implementation of the SyncService
    *
    * @param platformClient
    *   The low-level platform client which allows for simple send and receive semantics through
    *   websockets
    * @param pendingSubmissions
    *   Transactions that were submitted but haven't received a response. The protocol should
    *   respond in the same order as transactions are submitted, so a Queue is enough
    * @param blocksBuffer
    *   A buffer of received blocks to implement backpressure
    * @param semaphore
    *   Needed to make tx submission and enqueuing pending request atomic
    */
  class Live[F[_]: GenConcurrentThrow](
      platformClient: PlatformClient[F],
      pendingSubmissions: Queue[F, Deferred[F, SubmissionResponse]],
      blocksBuffer: Queue[F, Block],
      semaphore: Semaphore[F],
  ) extends SyncService[F] {
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

    override def sync(): F[Stream[F, Block]] =
      // Request next block for the first time if the client requested to sync
      requestNext.as(Stream.repeatEval(blocksBuffer.take))

    private def requestNext: F[Unit] =
      platformClient.send(SendMessage.LocalBlockSync.RequestNext)

    private val loopReceive: F[Unit] =
      platformClient
        .receive()
        .flatMap(processReceivedMessage)
        .foreverM

    private def processReceivedMessage(message: ReceiveMessage): F[Unit] =
      message match {
        case LocalTxSubmission.AcceptTx          => completeWith(Accepted)
        case LocalTxSubmission.RejectTx(details) => completeWith(Rejected(details.reason))
        case LocalBlockSync.RollForward(block)   => blocksBuffer.offer(block) >> requestNext
        case LocalBlockSync.RollBackward(_)      => ().pure >> requestNext
        case LocalBlockSync.AwaitReply           => ().pure
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
    def apply[F[_]: GenConcurrentThrow](
        platformClient: PlatformClient[F],
        blocksBufferSize: Int,
    ): Resource[F, Live[F]] = {
      // For the blocks we want a bounded queue so the producer is blocked
      // when the capacity is reached and we don't overwhelm the consumer,
      // nor lose any blocks.
      // Such scenario could very well happen when syncing from scratch,
      // where there is a huge amount of blocks to download.
      val blocksQueue = Queue.bounded[F, Block](blocksBufferSize)

      // For the pending submissions an unbounded queue is fine because it's up
      // to the client to decide if it wants to fill up the memory with these requests.
      val submissionsQueue = Queue.unbounded[F, Deferred[F, SubmissionResponse]]

      val semaphore = Semaphore[F](1)

      val instance = (submissionsQueue, blocksQueue, semaphore)
        .mapN(new Live[F](platformClient, _, _, _))

      Resource.eval(instance).flatTap(_.loopReceive.background)
    }
  }

  sealed trait SubmissionResponse
  object SubmissionResponse {
    case object Accepted extends SubmissionResponse
    final case class Rejected(reason: String) extends SubmissionResponse
  }

  sealed abstract class Error(message: String) extends Exception(message)
  object Error {
    case class UnexpectedMessageReceived(message: ReceiveMessage)
        extends Error(s"Unexpected message received: ${message.toString}")
    case class EmptyPendingSubmissions(response: SubmissionResponse)
        extends Error(s"${response.toString} was received but no request was pending")
    case class DeferredFailed(response: SubmissionResponse)
        extends Error(s"Deferred fail to complete for ${response.toString}")
  }
}
