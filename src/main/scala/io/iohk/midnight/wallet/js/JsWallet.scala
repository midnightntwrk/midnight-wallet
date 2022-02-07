package io.iohk.midnight.wallet.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.iohk.midnight.wallet.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.WalletBuilder.Config
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.{Wallet, WalletBuilder}
import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.*
import sttp.model.Uri

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@SuppressWarnings(Array("org.wartremover.warts.Product", "org.wartremover.warts.Serializable"))
@JSExportTopLevel("Wallet")
class JsWallet(wallet: Wallet[IO], finalizer: IO[Unit]) {
  @JSExport
  def call(
      deployTransactionHash: String,
      transitionFunction: String,
      publicTranscript: String,
  ): Promise[CallResult] =
    wallet
      .callContract(
        CallContractInput(
          Hash[DeployTransaction](deployTransactionHash),
          PublicTranscript(publicTranscript),
          TransitionFunction(transitionFunction),
          CircuitValues.hardcoded,
        ),
      )
      .attempt
      .map {
        case Left(error) => Failed(error.getMessage)
        case Right(hash) => Succeed(hash.value)
      }
      .unsafeToPromise()

  @JSExport
  def deploy(
      contractSource: String,
      publicState: String,
  ): Promise[CallResult] =
    wallet
      .deployContract(
        DeployContractInput(ContractSource(contractSource), PublicState(publicState)),
      )
      .attempt
      .map {
        case Left(error) => Failed(error.getMessage)
        case Right(hash) => Succeed(hash.value)
      }
      .unsafeToPromise()

  @JSExport
  def getGUID(): Promise[String] =
    wallet.getUserId().map(_.value).unsafeToPromise()

  @JSExport
  def sync(f: js.Function1[js.Array[String], Unit]): Unit =
    wallet
      .sync()
      .flatMap(_.map(events => f(events.map(_.value).toJSArray)).compile.drain)
      .unsafeRunAndForget()

  @JSExport
  def close(): Promise[Unit] = finalizer.unsafeToPromise()
}

@JSExportTopLevel("WalletBuilder")
object JsWallet {
  @JSExport
  def build(proverUri: String, platformUri: String, laresUri: String): js.Promise[JsWallet] =
    WalletBuilder
      .catsEffectWallet(
        Config.default(
          Uri.unsafeParse(proverUri),
          Uri.unsafeParse(platformUri),
          Uri.unsafeParse(laresUri),
        ),
      )
      .allocated
      .map { case (wallet, finalizer) => new JsWallet(wallet, finalizer) }
      .unsafeToPromise()
}
