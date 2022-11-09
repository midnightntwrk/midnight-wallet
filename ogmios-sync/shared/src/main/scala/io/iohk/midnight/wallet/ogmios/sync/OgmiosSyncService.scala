package io.iohk.midnight.wallet.ogmios.sync

import cats.MonadThrow
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.ogmios.sync.OgmiosSyncService.Error.UnexpectedMessageReceived
import io.iohk.midnight.wallet.ogmios.sync.protocol.Decoders.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.Encoders.*
import io.iohk.midnight.wallet.ogmios.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClient
import io.iohk.midnight.wallet.ogmios.sync.tracing.OgmiosSyncTracer

trait OgmiosSyncService[F[_]] {
  def sync(): Stream[F, Block]
}

/** Implementation of the SyncService
  *
  * @param webSocketClient
  *   The low-level node client which allows for simple send and receive semantics through
  *   websockets
  */
class OgmiosSyncServiceImpl[F[_]: MonadThrow](webSocketClient: JsonWebSocketClient[F])(implicit
    tracer: OgmiosSyncTracer[F],
) extends OgmiosSyncService[F] {

  def sync(): Stream[F, Block] =
    Stream.repeatEval(requestNextBlock)

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
  def apply[F[_]: MonadThrow: OgmiosSyncTracer](
      webSocketClient: JsonWebSocketClient[F],
  ): OgmiosSyncService[F] = new OgmiosSyncServiceImpl[F](webSocketClient)

  sealed abstract class Error(message: String) extends Exception(message)
  object Error {
    final case class UnexpectedMessageReceived(message: LocalBlockSync.Receive)
        extends Error(s"Unexpected message received: ${message.show}")
  }
}
