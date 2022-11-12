package io.iohk.midnight.wallet.engine.js

import cats.effect.{IO, Resource}
import cats.effect.unsafe.implicits.global
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import scala.scalajs.js
import scala.scalajs.js.annotation.*
import typings.midnightLedger.mod.{
  Transaction as LedgerTransaction,
  TransactionHash as LedgerTransactionHash,
}
import typings.midnightWalletApi.filterMod.Filter
import typings.midnightWalletApi.filterServiceMod.FilterService
import typings.midnightWalletApi.walletMod as api

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@JSExportTopLevel("Wallet")
class JsWallet(wallet: Wallet[IO], finalizer: IO[Unit]) extends api.Wallet with FilterService {

  override def submitTxReq(tx: LedgerTransaction): Observable[LedgerTransactionHash] =
    Observable.from(
      wallet
        .submitTransaction(tx)
        .unsafeToPromise(),
    )

  override def installTxReqFilter(
      filter: Filter[LedgerTransaction],
  ): Observable[LedgerTransaction] =
    wallet
      .sync()
      .filter(filter.apply)
      .unsafeToObservable()

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
      initialState: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    Resource
      .eval(IO.fromEither(Config.parse(nodeUri, initialState.toOption)))
      .flatMap(WalletBuilder.catsEffectWallet)
      .allocated
      .map((new JsWallet(_, _)).tupled)
      .unsafeToPromise()

  @JSExport
  def generateInitialState(): String =
    WalletBuilder.generateInitialState()
}
