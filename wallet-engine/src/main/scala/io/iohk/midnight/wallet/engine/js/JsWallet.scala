package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.midnightMockedNodeApi.distDataBlockMod.Block
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as NodeTx
import io.iohk.midnight.midnightMockedNodeApi.distDataTxSubmissionResultMod.TxSubmissionResult
import io.iohk.midnight.midnightWalletApi.distFilterServiceMod.FilterService
import io.iohk.midnight.midnightWalletApi.distTypesFilterMod.Filter
import io.iohk.midnight.midnightWalletApi.distWalletMod as api
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel}
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.engine.WalletBuilder.AllocatedWallet
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.tracing.JsWalletTracer
import io.iohk.midnight.wallet.engine.{WalletBlockProcessingService, WalletBuilder}

import scala.annotation.unused
import scala.scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.*

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@JSExportTopLevel("Wallet")
class JsWallet(
    walletBlockProcessingService: WalletBlockProcessingService[IO],
    walletStateService: WalletStateService[IO, Wallet],
    walletFilterService: WalletFilterService[IO],
    walletTxSubmissionService: WalletTxSubmissionService[IO],
    finalizer: IO[Unit],
) extends api.Wallet
    with FilterService {

  override def connect(): Observable_[ZSwapCoinPublicKey] =
    walletStateService.publicKey.unsafeToObservable()

  override def submitTx(
      tx: Transaction,
      newCoins: js.Array[CoinInfo],
  ): Observable_[TransactionIdentifier] =
    walletTxSubmissionService.submitTransaction(tx, newCoins.toList).unsafeToObservable()

  override def installTxFilter(filter: Filter[Transaction]): Observable_[Transaction] =
    walletFilterService
      .installTransactionFilter(
        filter.apply(_),
      ) // IMPORTANT: Don't convert this to method value - otherwise scalajs will try to use undefined `this` context
      .unsafeToObservable()

  def balance(): Observable_[js.BigInt] =
    walletStateService.balance.unsafeToObservable()

  def start(): Unit =
    walletBlockProcessingService.blocks.compile.drain.unsafeRunAndForget()

  def close(): js.Promise[Unit] =
    finalizer.unsafeRunSyncToPromise()
}

trait SyncSession extends js.Object {
  def sync(): Observable_[Block[NodeTx]]
  def close(): Unit
}

trait SubmitSession extends js.Object {
  def submitTx(@unused tx: NodeTx): Promise[TxSubmissionResult]
  def close(): Unit
}

trait NodeConnection extends js.Object {
  def startSyncSession(): Promise[SyncSession]
  def startSubmitSession(): Promise[SubmitSession]
}

@JSExportTopLevel("WalletBuilder")
// $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
object JsWallet {

  @JSExport
  def build(
      nodeConnection: NodeConnection,
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    internalBuild(nodeConnection, initialState, minLogLevel)

  private def internalBuild(
      nodeConnection: NodeConnection,
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] = {
    val rawConfig = RawConfig(nodeConnection, initialState.toOption, minLogLevel.toOption)

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

  def apply(wallet: AllocatedWallet[IO, Wallet]): JsWallet =
    new JsWallet(
      wallet.dependencies.walletBlockProcessingService,
      wallet.dependencies.walletStateService,
      wallet.dependencies.walletFilterService,
      wallet.dependencies.walletTxSubmissionService,
      wallet.finalizer,
    )

  @JSExport
  def calculateCost(tx: Transaction): js.BigInt =
    WalletStateService.calculateCost(tx)

  @JSExport
  def generateInitialState(): String =
    LedgerSerialization.serializeState(new ZSwapLocalState())
}
