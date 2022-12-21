package io.iohk.midnight.wallet.ogmios.sync

import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService.Error.UnexpectedMessageReceived
import io.iohk.midnight.wallet.ogmios.sync.protocol.Decoders.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.Encoders.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClient
import io.iohk.midnight.wallet.ogmios.sync.tracing.OgmiosSyncTracer
import cats.effect.kernel.Resource
import fs2.concurrent.SignallingRef
import cats.effect.Concurrent
import sttp.ws.WebSocketClosed

trait OgmiosSyncService[F[_]] {
  def sync(): Stream[F, Block]
}

/** Implementation of the SyncService
  *
  * @param webSocketClient
  *   The low-level node client which allows for simple send and receive semantics through
  *   websockets
  */
class OgmiosSyncServiceImpl[F[_]: Concurrent](
    webSocketClient: JsonWebSocketClient[F],
    releaseSignal: SignallingRef[F, Boolean],
)(implicit
    tracer: OgmiosSyncTracer[F],
) extends OgmiosSyncService[F] {

  def sync(): Stream[F, Block] = {
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

  private def receive: F[LocalBlockSync.Receive] =
    webSocketClient.receive[LocalBlockSync.Receive]()

  private def processResponse(msg: LocalBlockSync.Receive): F[Block] =
    msg match {
      case LocalBlockSync.Receive.RollForward(block) =>
        tracer.rollForwardReceived(block).as(block)
      case LocalBlockSync.Receive.RollBackward(hash) =>
        tracer.rollBackwardReceived(hash) >> requestNextBlock
      case LocalBlockSync.Receive.AwaitReply =>
        tracer.awaitReplyReceived >> receive.flatMap(processResponse)
      case other =>
        val error = UnexpectedMessageReceived(other)
        tracer.unexpectedMessage(other) >> error.raiseError
    }
}

object OgmiosSyncService {

  def apply[F[_]: Concurrent: OgmiosSyncTracer](
      webSocketClient: JsonWebSocketClient[F],
  ): Resource[F, OgmiosSyncService[F]] = {
    val signalResource: Resource[F, SignallingRef[F, Boolean]] =
      Resource.eval(SignallingRef[F, Boolean](false))

    signalResource.flatMap { signal =>
      Resource.make[F, OgmiosSyncServiceImpl[F]](
        acquire = Concurrent[F].pure(new OgmiosSyncServiceImpl[F](webSocketClient, signal)),
      )(release = _.close)
    }
  }

  sealed abstract class Error(message: String) extends Exception(message)
  object Error {
    final case class UnexpectedMessageReceived(message: LocalBlockSync.Receive)
        extends Error(s"Unexpected message received: ${message.show}")
  }
}
