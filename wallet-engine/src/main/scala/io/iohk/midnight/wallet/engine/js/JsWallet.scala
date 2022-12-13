package io.iohk.midnight.wallet.engine.js

import cats.effect.unsafe.implicits.global
import cats.effect.{IO, Resource}
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightWalletApi.distFilterServiceMod.FilterService
import io.iohk.midnight.midnightWalletApi.distTypesFilterMod.Filter
import io.iohk.midnight.midnightWalletApi.distWalletMod as api
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.wallet.core.{WalletFilterService, WalletState, WalletTxSubmission}
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.Config

import scala.scalajs.js
import scala.scalajs.js.annotation.*

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@JSExportTopLevel("Wallet")
class JsWallet(
    walletState: WalletState[IO],
    walletFilterService: WalletFilterService[IO],
    walletTxSubmission: WalletTxSubmission[IO],
    finalizer: IO[Unit],
) extends api.Wallet
    with FilterService {

  override def connect(): Observable_[ZSwapCoinPublicKey] =
    walletState.publicKey.unsafeToObservable()

  override def submitTx(
      tx: Transaction,
      newCoins: js.Array[CoinInfo],
  ): Observable_[TransactionIdentifier] =
    walletTxSubmission.submitTransaction(tx, newCoins.toList).unsafeToObservable()

  override def installTxFilter(filter: Filter[Transaction]): Observable_[Transaction] =
    walletFilterService
      .installTransactionFilter(filter.apply(_)) // IMPORTANT: Don't convert this to method value
      .unsafeToObservable()

  def balance(): Observable_[js.BigInt] =
    walletState.balance.unsafeToObservable()

  def start(): Unit =
    walletState.start.unsafeRunAndForget()

  def close(): js.Promise[Unit] =
    finalizer.unsafeToPromise()
}

@JSExportTopLevel("WalletBuilder")
object JsWalletBuilder {
  @JSExport
  def build(
      nodeUri: String,
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    Resource
      .eval(IO.fromEither(Config.parse(nodeUri, initialState.toOption, minLogLevel.toOption)))
      .flatMap(WalletBuilder.catsEffectWallet)
      .allocated
      .map { case ((state, filterService, txSubmission), finalizer) =>
        new JsWallet(state, filterService, txSubmission, finalizer)
      }
      .unsafeToPromise()

  @JSExport
  def calculateCost(tx: Transaction): js.BigInt =
    WalletState.calculateCost(tx)

  @JSExport
  def generateInitialState(): String =
    WalletBuilder.generateInitialState()
}
