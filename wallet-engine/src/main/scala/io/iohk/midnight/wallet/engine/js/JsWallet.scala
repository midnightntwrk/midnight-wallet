package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import fs2.Stream
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.wallet.blockchain.data.{
  Address,
  Block,
  CircuitValues,
  FunctionName,
  Nonce,
  TransitionFunctionCircuits,
  Hash as DataHash,
}
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.core.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import scala.scalajs.js
import scala.scalajs.js.annotation.*
import sttp.model.Uri
import typings.midnightWalletApi.filterMod.Filter
import typings.midnightWalletApi.filterServiceMod.FilterService
import typings.midnightWalletApi.hashMod.Hash
import typings.midnightWalletApi.transactionMod.*
import typings.midnightWalletApi.walletMod as api

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@SuppressWarnings(Array("org.wartremover.warts.Product", "org.wartremover.warts.Serializable"))
@JSExportTopLevel("Wallet")
class JsWallet(wallet: Wallet[IO], finalizer: IO[Unit]) extends api.Wallet with FilterService {

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
    val txType = tx.asInstanceOf[js.Dynamic].`type`.asInstanceOf[String]
    if (CALL_TX == txType) {
      buildCallContractInput(tx.asInstanceOf[CallTransaction]).map(Left(_))
    } else if (DEPLOY_TX == txType) {
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
          DataHash(callTx.hash),
          Address(callTx.address),
          FunctionName(callTx.functionName),
          Nonce(callTx.nonce),
          _,
          CircuitValues(1, 2, 3),
        )
      }

  private def buildDeployContractInput(deployTx: DeployTransaction): IO[DeployContractInput] =
    Transformers.ApiToData
      .transformPublicOracle[IO](deployTx.publicOracle)
      .map {
        DeployContractInput(
          DataHash(deployTx.hash),
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
    block.body.transactionResults.map(Transformers.DataToApi.transformTransaction)

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
}
