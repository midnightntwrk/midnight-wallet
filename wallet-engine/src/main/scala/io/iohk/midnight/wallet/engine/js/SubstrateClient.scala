package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.syntax.either.*
import cats.effect.unsafe.implicits.global
import io.iohk.midnight.midnightZswap.mod.Transaction
import io.iohk.midnight.wallet.substrate.SubstrateClient as ScalaSubstrateClient
import sttp.model.Uri

import scalajs.js
import scala.scalajs.js.|
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}
import scala.scalajs.js.typedarray.Uint8Array
import io.iohk.midnight.wallet.substrate
import io.iohk.midnight.wallet.substrate.{SubmitTransactionRequest, SubmitTransactionResponse}

trait SubstrateClient extends js.Object {
  def submitTransaction(transaction: Transaction): js.Promise[ExtrinsicsHash | RpcError]
  def close(): js.Promise[Unit]
}

trait ExtrinsicsHash extends js.Object {
  def hash: Uint8Array
}

trait RpcError extends js.Object {
  def code: Int
  def message: String
  def data: String
}

@SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
@JSExportTopLevel("SubstrateClient")
object SubstrateClient {
  @JSExport
  def create(uri: String): js.Promise[SubstrateClient] = {
    IO.fromEither(Uri.parse(uri).leftMap(new Throwable(_)))
      .flatMap { nodeUri =>
        ScalaSubstrateClient[IO](nodeUri).allocated.map { case (client, finalizer) =>
          new SubstrateClient:
            override def submitTransaction(
                transaction: Transaction,
            ): js.Promise[ExtrinsicsHash | RpcError] =
              client
                .submitTransaction(SubmitTransactionRequest(transaction))
                .flatMap { response =>
                  response match
                    case SubmitTransactionResponse(substrate.ExtrinsicsHash(extrinsicsHash)) =>
                      IO(
                        |.from(
                          new ExtrinsicsHash {
                            override def hash: Uint8Array = extrinsicsHash.asInstanceOf[Uint8Array]
                          },
                        ),
                      )
                    case SubmitTransactionResponse(
                          substrate.RpcError(errorCode, errorMessage, errorData),
                        ) =>
                      IO(
                        |.from(
                          new RpcError {
                            override def code: Int = errorCode
                            override def message: String = errorMessage
                            override def data: String = errorData
                          },
                        ),
                      )
                    case _ =>
                      IO.raiseError[ExtrinsicsHash | RpcError](new Throwable("Bad response format"))
                }
                .unsafeToPromise()

            override def close(): js.Promise[Unit] = finalizer.unsafeRunSyncToPromise()
        }
      }
      .unsafeToPromise()
  }
}
