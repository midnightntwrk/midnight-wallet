package io.iohk.midnight.wallet.ouroboros.sync

import cats.Show
import cats.effect.Concurrent
import cats.effect.kernel.Resource
import cats.syntax.all.*
import fs2.Stream
import fs2.concurrent.SignallingRef
import io.circe.Decoder
import io.iohk.midnight.wallet.ouroboros.network.JsonWebSocketClient
import io.iohk.midnight.wallet.ouroboros.sync.OuroborosSyncService.Error.UnexpectedMessageReceived
import io.iohk.midnight.wallet.ouroboros.sync.protocol.Decoders.*
import io.iohk.midnight.wallet.ouroboros.sync.protocol.Encoders.*
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ouroboros.sync.tracing.OuroborosSyncTracer
import sttp.ws.WebSocketClosed

trait OuroborosSyncService[F[_], Block] {
  def sync: Stream[F, Block]
}

/** Implementation of the SyncService
  *
  * @param webSocketClient
  *   The low-level node client which allows for simple send and receive semantics through
  *   websockets
  */
class OuroborosSyncServiceImpl[F[_]: Concurrent, Block: Decoder: Show](
    webSocketClient: JsonWebSocketClient[F],
    releaseSignal: SignallingRef[F, Boolean],
)(implicit
    tracer: OuroborosSyncTracer[F],
) extends OuroborosSyncService[F, Block] {

  def sync: Stream[F, Block] = {
    def ignoreWsClosedErrorDuringRelease(result: Either[Throwable, Block]): F[Option[Block]] =
      result match {
        case Right(b) => Option(b).pure
        case Left(t: WebSocketClosed) =>
          releaseSignal.get.ifM(Option.empty[Block].pure, t.raiseError)
        case Left(t) => t.raiseError
      }

    Stream
      .attemptEval(requestNextBlock)
      .repeat
      .evalMapFilter(ignoreWsClosedErrorDuringRelease)
      .interruptWhen(releaseSignal)
  }

  def close: F[Unit] = releaseSignal.set(true)

  private def requestNextBlock: F[Block] =
    send >> tracer.nextBlockRequested >> receive.flatMap(processResponse)

  private def send: F[Unit] =
    webSocketClient.send[LocalBlockSync.Send](LocalBlockSync.Send.RequestNext)

  private def receive: F[LocalBlockSync.Receive[Block]] =
    webSocketClient.receive[LocalBlockSync.Receive[Block]]()

  private def processResponse(msg: LocalBlockSync.Receive[Block]): F[Block] =
    msg match {
      case LocalBlockSync.Receive.RollForward(block) =>
        // This call to 'implicitly' is needed for Scala 3.
        // Otherwise it fails with an error about lack of given instance.
        tracer.rollForwardReceived(block)(implicitly[Show[Block]]).as(block)

      case LocalBlockSync.Receive.RollBackward(hash) =>
        tracer.rollBackwardReceived(hash) >> requestNextBlock

      case LocalBlockSync.Receive.AwaitReply =>
        tracer.awaitReplyReceived >> receive.flatMap(
          processResponse,
        )

      case other =>
        val error = UnexpectedMessageReceived[Block](other)
        tracer.unexpectedMessage(other) >> error.raiseError[F, Block]
    }
}

object OuroborosSyncService {
  def apply[F[_]: Concurrent: OuroborosSyncTracer, Block: Decoder: Show](
      webSocketClient: JsonWebSocketClient[F],
  ): Resource[F, OuroborosSyncService[F, Block]] = {
    val signalResource: Resource[F, SignallingRef[F, Boolean]] =
      Resource.eval(SignallingRef[F, Boolean](false))

    signalResource.flatMap { signal =>
      Resource.make[F, OuroborosSyncServiceImpl[F, Block]](
        acquire =
          Concurrent[F].pure(new OuroborosSyncServiceImpl[F, Block](webSocketClient, signal)),
      )(release = _.close)
    }
  }

  sealed abstract class Error(message: String) extends Exception(message)
  object Error {
    final case class UnexpectedMessageReceived[Block](message: LocalBlockSync.Receive[Block])
        extends Error(s"Unexpected message received: ${message.show}")
  }
}
