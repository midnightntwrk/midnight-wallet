package io.iohk.midnight.wallet.js

import cats.effect.unsafe.implicits.global
import io.iohk.midnight.wallet.WalletBuilder
import io.iohk.midnight.wallet.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.domain.*
import scala.scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.*
import sttp.model.Uri
import typings.api.mod
import typings.api.mod.{GUID, SemanticEvent}

/** Implementation of the Typescript interface. This class delegates calls to the Scala Wallet and
  * transforms any Scala-specific type into its corresponding Javascript one
  */
@JSExportTopLevel("Wallet")
object JsWallet {
  @JSExport
  def build(proverUri: String, platformUri: String): js.Promise[WalletBaseImpl] =
    WalletBuilder
      .catsEffectWallet(Uri.unsafeParse(proverUri), Uri.unsafeParse(platformUri))
      .allocated
      .map { case (walletAPI, finalizer) =>
        val walletInternal = new mod.WalletInternal {
          override def call(
              deployTransactionHash: mod.Hash,
              transitionFunction: mod.TransitionFunction,
              publicTranscript: mod.PublicTranscript,
          ): Promise[mod.CallResult] =
            walletAPI
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
                case Left(error) => mod.Failed(error.getMessage)
                case Right(hash) => mod.Succeed(hash.value)
              }
              .unsafeToPromise()

          override def deploy(
              contractSource: mod.ContractSource,
              publicState: mod.PublicState,
          ): Promise[mod.CallResult] =
            walletAPI
              .deployContract(
                DeployContractInput(ContractSource(contractSource), PublicState(publicState)),
              )
              .attempt
              .map {
                case Left(error) => mod.Failed(error.getMessage)
                case Right(hash) => mod.Succeed(hash.value)
              }
              .unsafeToPromise()

          override def getGUID(): Promise[GUID] = ???

          override def sync(f: js.Function1[js.Array[SemanticEvent], Unit]): Unit = ???

          override def close(): Promise[Unit] = finalizer.unsafeToPromise()
        }

        new WalletBaseImpl(walletInternal)
      }
      .unsafeToPromise()
}
