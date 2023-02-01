package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as NodeTx
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import io.iohk.midnight.midnightWalletApi.distFilterServiceMod.FilterService
import io.iohk.midnight.midnightWalletApi.distTypesFilterMod.Filter
import io.iohk.midnight.midnightWalletApi.distWalletMod as api
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel}
import io.iohk.midnight.wallet.core.{
  LedgerSerialization,
  WalletFilterService,
  WalletState,
  WalletTxSubmission,
}
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.AllocatedWallet
import io.iohk.midnight.wallet.engine.config.RawNodeConnection.RawNodeInstance
import io.iohk.midnight.wallet.engine.config.RawNodeConnection.RawNodeUri
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig, RawNodeConnection}
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
object JsWallet {
  @JSExport
  def build(
      node: MockedNode[NodeTx],
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    internalBuild(RawNodeInstance(node), initialState, minLogLevel)

  @JSExport
  def connect(
      nodeUri: String,
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    internalBuild(RawNodeUri(nodeUri), initialState, minLogLevel)

  private def internalBuild(
      rawNodeConnection: RawNodeConnection,
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] = {
    val rawConfig = RawConfig(rawNodeConnection, initialState.toOption, minLogLevel.toOption)

    val jsWalletIO = for {
      _ <- jsWalletTracer.jsWalletBuildRequested(rawConfig)
      config <- parseConfig(rawConfig)
      allocatedWallet <- WalletBuilder.build[IO](config)
    } yield JsWallet(allocatedWallet)

    jsWalletIO.unsafeToPromise()
  }

  private val jsWalletTracer =
    JsWalletTracer.from[IO](ConsoleTracer.contextAware(LogLevel.Debug))

  private def parseConfig(rawConfig: RawConfig): IO[Config] =
    IO
      .fromEither(Config.parse(rawConfig))
      .attemptTap {
        case Right(config) => jsWalletTracer.configConstructed(config)
        case Left(t)       => jsWalletTracer.invalidConfig(t)
      }

  def apply(wallet: AllocatedWallet[IO]): JsWallet =
    new JsWallet(
      wallet.dependencies.state,
      wallet.dependencies.filterService,
      wallet.dependencies.txSubmissionService,
      wallet.finalizer,
    )

  @JSExport
  def calculateCost(tx: Transaction): js.BigInt =
    WalletState.calculateCost(tx)

  @JSExport
  def generateInitialState(): String =
    LedgerSerialization.serializeState(new ZSwapLocalState())
}
