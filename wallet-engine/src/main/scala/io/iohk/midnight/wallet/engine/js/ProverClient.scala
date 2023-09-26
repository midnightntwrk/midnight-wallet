package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.syntax.either.*
import cats.effect.unsafe.implicits.global
import io.iohk.midnight.wallet.prover.ProverClient as ScalaProverClient
import io.iohk.midnight.wallet.zswap.{Offer, Transaction, UnprovenOffer, UnprovenTransaction}
import sttp.model.Uri
import scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}

trait ProverClient extends js.Object {
  def proveTransaction(tx: UnprovenTransaction): js.Promise[Transaction]
  def proveOffer(offer: UnprovenOffer): js.Promise[Offer]
  def close(): js.Promise[Unit]
}

@JSExportTopLevel("ProverClient")
object ProverClient {
  @JSExport
  def create(uri: String): js.Promise[ProverClient] = {
    IO.fromEither(Uri.parse(uri).leftMap(new Throwable(_)))
      .flatMap { proverUri =>
        ScalaProverClient[IO](proverUri).allocated.map { case (client, finalizer) =>
          new ProverClient:
            override def proveTransaction(tx: UnprovenTransaction): Promise[Transaction] =
              client.proveTransaction(tx).unsafeToPromise()

            override def proveOffer(offer: UnprovenOffer): Promise[Offer] =
              client.proveOffer(offer).unsafeToPromise()

            override def close(): Promise[Unit] = finalizer.unsafeRunSyncToPromise()
        }
      }
      .unsafeToPromise()
  }
}
