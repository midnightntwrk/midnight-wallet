package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.{
  Address,
  Block,
  CircuitValues,
  FunctionName,
  Nonce,
  TransitionFunctionCircuits,
}
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.core.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.core.js.facades.rxjs.{Observable, Subscriber}
import io.iohk.midnight.wallet.core.util.Subscription
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import io.iohk.midnight.wallet.engine.js.JsWallet.StreamObservableOps

import scala.scalajs.js
import scala.scalajs.js.|
import scala.scalajs.js.ThisFunction.fromFunction2
import scala.scalajs.js.annotation.*
import sttp.model.Uri
import typings.midnightWalletApi.filterMod.Filter
import typings.midnightWalletApi.filterServiceMod.FilterService
import typings.midnightWalletApi.hashMod.Hash
import typings.midnightWalletApi.midnightWalletApiStrings.{Call, Deploy}
import typings.midnightWalletApi.transactionMod.*
import typings.midnightWalletApi.walletMod as api

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@SuppressWarnings(Array("org.wartremover.warts.Product", "org.wartremover.warts.Serializable"))
@JSExportTopLevel("Wallet")
class JsWallet(wallet: Wallet[IO], finalizer: IO[Unit]) extends api.Wallet with FilterService {

  private val callType: CALL_TX | DEPLOY_TX = Call
  private val deployType: CALL_TX | DEPLOY_TX = Deploy

  override def submitTxReq(tx: Transaction): Observable[Hash] =
    Observable.from(
      buildWalletInput(tx)
        .flatMap(_.fold(wallet.callContract, wallet.deployContract))
        .map(_.value)
        .unsafeToPromise(),
    )
  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf", "org.wartremover.warts.Equals"))
  private def buildWalletInput(
      tx: Transaction,
  ): IO[Either[CallContractInput, DeployContractInput]] = {
    if (callType == tx.`type`) {
      buildCallContractInput(tx.asInstanceOf[CallTransaction]).map(Left(_))
    } else if (deployType == tx.`type`) {
      buildDeployContractInput(tx.asInstanceOf[DeployTransaction]).map(Right(_))
    } else {
      IO.raiseError(new Error("Tx match wasn't CallTx neither DeployTx"))
    }
  }

  private def buildCallContractInput(callTx: CallTransaction): IO[CallContractInput] =
    Transformers.ApiToData
      .transformTranscript[IO](callTx.publicTranscript)
      .map {
        CallContractInput(
          Address(callTx.address),
          FunctionName(callTx.functionName),
          Nonce(callTx.nonce),
          _,
          CircuitValues(1, 2, 3),
        )
      }

  private def buildDeployContractInput(deployTx: DeployTransaction): IO[DeployContractInput] =
    Transformers.ApiToData
      .transformContract[IO](deployTx.contract)
      .map {
        DeployContractInput(
          _,
          TransitionFunctionCircuits(deployTx.transitionFunctionCircuits.toSeq),
        )
      }

  override def installTxReqFilter(filter: Filter[Transaction]): Observable[Transaction] =
    wallet
      .sync()
      .map(transformTxResults)
      .flatMap(Stream.emits)
      .filter(filter.apply)
      .unsafeToObservable()

  private def transformTxResults(block: Block): Seq[Transaction] =
    block.body.transactionResults
      .map(_.transaction)
      .map(Transformers.DataToApi.transformTransaction)

  def close(): Unit =
    finalizer.unsafeRunAndForget()
}

@JSExportTopLevel("WalletBuilder")
object JsWallet {
  @JSExport
  def build(
      proverUri: String,
      nodeUri: String,
      includeCookies: Boolean,
  ): js.Promise[api.Wallet] =
    WalletBuilder
      .catsEffectWallet(
        Config.default( // [TODO PM-5110] Improve config creation
          Uri.unsafeParse(proverUri),
          Uri.unsafeParse(nodeUri),
          includeCookies,
        ),
      )
      .allocated
      .map { case (wallet, finalizer) => new JsWallet(wallet, finalizer) }
      .unsafeToPromise()

  implicit class StreamObservableOps[T](stream: Stream[IO, T]) {
    def unsafeToObservable(): Observable[T] =
      new Observable[T](
        fromFunction2[Observable[T], Subscriber[T], js.Function0[Unit]]((_, subscriber) => {
          val subscription = Subscription.fromStream(stream, subscriber)
          subscription.startConsuming.unsafeRunAndForget()
          () => subscription.cancellation.unsafeRunAndForget()
        }),
      )
  }
}
