package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.parser
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.core.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.core.js.facades.rxjs.{Observable, Subscriber}
import io.iohk.midnight.wallet.core.util.{StreamObservable, StreamObserver, Subscription}
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import sttp.model.Uri
import typings.midnightWalletApi.mod as api

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.{Promise, Array as JsArray}
import scala.scalajs.js.annotation.*

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@SuppressWarnings(Array("org.wartremover.warts.Product", "org.wartremover.warts.Serializable"))
@JSExportTopLevel("Wallet")
class JsWallet(wallet: Wallet[IO], finalizer: IO[Unit]) extends api.Wallet {
  override def call(
      deployTransactionHash: String,
      nonce: String,
      transitionFunction: String,
      publicTranscript: String,
  ): Promise[api.TxSubmissionResult] =
    IO.fromEither(parser.parse(publicTranscript))
      .flatMap { parsed =>
        wallet
          .callContract(
            CallContractInput(
              Hash[DeployTransaction](deployTransactionHash),
              Nonce(nonce),
              PublicTranscript(parsed),
              TransitionFunction(transitionFunction),
              CircuitValues.hardcoded,
            ),
          )
      }
      .attempt
      .map {
        case Left(error) => api.Failed(error.getMessage)
        case Right(hash) => api.Succeed(hash.value)
      }
      .unsafeToPromise()

  override def deploy(
      contractSource: String,
      publicState: String,
  ): Promise[api.TxSubmissionResult] =
    IO.fromEither(parser.parse(publicState))
      .flatMap { parsed =>
        wallet
          .deployContract(
            DeployContractInput(ContractSource(contractSource), PublicState(parsed)),
          )
      }
      .attempt
      .map {
        case Left(error) => api.Failed(error.getMessage)
        case Right(hash) => api.Succeed(hash.value)
      }
      .unsafeToPromise()

  override def getGUID(): Promise[String] =
    wallet.getUserId().map(_.value).unsafeToPromise()

  override def sync(): Observable[JsArray[Any]] = {
    new Observable[JsArray[Any]](
      js.ThisFunction.fromFunction2[Observable[JsArray[Any]], Subscriber[
        JsArray[Any],
      ], js.Function0[Unit]]((_, subscriber) => {
        val Subscription(startConsuming, cancellation) =
          new StreamObservable[IO, Seq[Any]](wallet.sync())
            .subscribe(new StreamObserver[IO, Seq[Any]] {
              override def next(value: Seq[Any]): IO[Unit] =
                IO(subscriber.next(value.toJSArray))

              override def error(error: Throwable): IO[Unit] =
                IO(subscriber.error(error.getMessage))

              override def complete(): IO[Unit] = IO(subscriber.complete())
            })

        startConsuming.unsafeRunAndForget()
        () => cancellation.unsafeRunAndForget()
      }),
    )
  }

  override def close(): Promise[Unit] = finalizer.unsafeToPromise()
}

@JSExportTopLevel("WalletBuilder")
object JsWallet {
  @JSExport
  def build(
      proverUri: String,
      platformUri: String,
      includeCookies: Boolean,
  ): js.Promise[api.Wallet] =
    WalletBuilder
      .catsEffectWallet(
        Config.default(
          Uri.unsafeParse(proverUri),
          Uri.unsafeParse(platformUri),
          includeCookies,
        ),
      )
      .allocated
      .map { case (wallet, finalizer) => new JsWallet(wallet, finalizer) }
      .unsafeToPromise()
}
