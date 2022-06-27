package io.iohk.midnight.wallet.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.parser
import io.iohk.midnight.wallet.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.WalletBuilder.Config
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.js.facades.rxjs.{Observable, Subscriber}
import io.iohk.midnight.wallet.util.{StreamObservable, StreamObserver, Subscription}
import io.iohk.midnight.wallet.{Wallet, WalletBuilder}
import sttp.model.Uri
import typings.midnightWalletApi.mod as api

import scala.scalajs.js
import scala.scalajs.js.Promise
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

  override def sync(): Observable[Seq[SemanticEvent]] = {
    new Observable[Seq[SemanticEvent]](
      js.ThisFunction.fromFunction2[Observable[Seq[SemanticEvent]], Subscriber[
        Seq[SemanticEvent],
      ], js.Function0[Unit]]((_, subscriber) => {
        val Subscription(startConsuming, cancellation) =
          new StreamObservable[IO, Seq[SemanticEvent]](wallet.sync())
            .subscribe(new StreamObserver[IO, Seq[SemanticEvent]] {
              override def next(value: Seq[SemanticEvent]): IO[Unit] =
                IO(subscriber.next(value))

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
      laresUri: String,
      includeCookies: Boolean,
  ): js.Promise[api.Wallet] =
    WalletBuilder
      .catsEffectWallet(
        Config.default(
          Uri.unsafeParse(proverUri),
          Uri.unsafeParse(platformUri),
          Uri.unsafeParse(laresUri),
          includeCookies,
        ),
      )
      .allocated
      .map { case (wallet, finalizer) => new JsWallet(wallet, finalizer) }
      .unsafeToPromise()
}
