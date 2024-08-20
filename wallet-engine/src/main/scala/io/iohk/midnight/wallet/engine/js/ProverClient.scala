package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.either.*
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.prover.ProverClient as ScalaProverClient
import io.iohk.midnight.wallet.zswap.{NetworkId, Transaction, UnprovenTransaction}
import scala.scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}
import sttp.model.Uri

trait ProverClient extends js.Object {
  def proveTransaction(tx: UnprovenTransaction): js.Promise[Transaction]
  def close(): js.Promise[Unit]
}

@JSExportTopLevel("ProverClient")
object ProverClient {
  @JSExport
  def create(uri: String)(using ProtocolVersion, NetworkId): js.Promise[ProverClient] = {
    IO.fromEither(Uri.parse(uri).leftMap(new Throwable(_)))
      .flatMap { proverUri =>
        ScalaProverClient[IO](proverUri).allocated.map { case (client, finalizer) =>
          new ProverClient {
            override def proveTransaction(tx: UnprovenTransaction): Promise[Transaction] =
              client.proveTransaction(tx).unsafeToPromise()

            override def close(): Promise[Unit] = finalizer.unsafeRunSyncToPromise()
          }
        }
      }
      .unsafeToPromise()
  }
}
