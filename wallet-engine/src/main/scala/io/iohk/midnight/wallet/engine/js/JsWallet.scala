package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightWalletApi.distFilterServiceMod.FilterService
import io.iohk.midnight.midnightWalletApi.distTypesFilterMod.Filter
import io.iohk.midnight.midnightWalletApi.distWalletMod as api
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.WalletFilterService
import io.iohk.midnight.wallet.core.WalletState
import io.iohk.midnight.wallet.core.WalletTxSubmission
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.Config
import io.iohk.midnight.wallet.engine.tracing.JsWalletTracer

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
  ): js.Promise[api.Wallet] = {
    val jsWalletTracer = JsWalletTracer.from[IO](
      logging.ConsoleTracer.contextAware(
        logging.LogLevel.Debug,
      ),
    )

    val logBuildRequest = jsWalletTracer.jsWalletBuildRequested(
      nodeUri,
      initialState.toOption,
      minLogLevel.toOption,
    )

    val parseConfig = IO
      .fromEither(Config.parse(nodeUri, initialState.toOption, minLogLevel.toOption))
      .attemptTap {
        case Right(config) => jsWalletTracer.configConstructed(config)
        case Left(t)       => jsWalletTracer.invalidConfig(t)
      }

    def walletResources(config: Config) = {
      val rootTracer: Tracer[IO, StructuredLog] =
        logging.ConsoleTracer.contextAware(config.minLogLevel)
      WalletBuilder.catsEffectWallet(config)(rootTracer).allocated
    }

    val jsWallet = for {
      _ <- logBuildRequest
      config <- parseConfig
      wallet <- walletResources(config).map {
        case ((state, filterService, txSubmission), finalizer) =>
          new JsWallet(state, filterService, txSubmission, finalizer)
      }
    } yield wallet

    jsWallet.unsafeToPromise()
  }

  @JSExport
  def calculateCost(tx: Transaction): js.BigInt =
    WalletState.calculateCost(tx)

  @JSExport
  def generateInitialState(): String =
    WalletBuilder.generateInitialState()
}
