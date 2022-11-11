package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import fs2.Stream
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.Wallet
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
@JSExportTopLevel("Wallet")
class JsWallet(wallet: Wallet[IO], finalizer: IO[Unit]) extends api.Wallet with FilterService {

  override def submitTxReq(tx: Transaction): Observable[Hash] =
    Observable.from(
      Transformers.ApiToData
        .transformTransaction[IO](tx)
        .flatMap(wallet.submitTransaction)
        .map(_.value)
        .unsafeToPromise(),
    )

  override def installTxReqFilter(filter: Filter[Transaction]): Observable[Transaction] =
    wallet
      .sync()
      .map(transformTxResults)
      .flatMap(Stream.emits)
      .filter(filter.apply)
      .unsafeToObservable()

  private def transformTxResults(block: Block): Seq[Transaction] =
    block.body.transactionResults.map(Transformers.DataToApi.transformTransaction)

  def balance(): Observable[js.BigInt] =
    wallet.balance().unsafeToObservable()

  def close(): Unit =
    finalizer.unsafeRunAndForget()
}

@JSExportTopLevel("WalletBuilder")
object JsWallet {
  @JSExport
  def build(
      nodeUri: String,
  ): js.Promise[api.Wallet] =
    WalletBuilder
      .catsEffectWallet(
        Config.default( // [TODO PM-5110] Improve config creation
          Uri.unsafeParse(nodeUri),
        ),
      )
      .allocated
      .map { case (wallet, finalizer) => new JsWallet(wallet, finalizer) }
      .unsafeToPromise()
}
