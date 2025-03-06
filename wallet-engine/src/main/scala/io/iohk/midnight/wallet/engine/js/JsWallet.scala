package io.iohk.midnight.wallet.engine.js

import cats.effect.{Deferred, IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.iohk.midnight.js.interop.TracerCarrier
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.{
  ApplyStage,
  BalanceTransactionToProve,
  NothingToProve,
  SyncProgress,
  TransactionHistoryEntry,
  TransactionIdentifier,
  TransactionToProve,
  WalletState,
  ProvingRecipe as ApiProvingRecipe,
  TokenTransfer as ApiTokenTransfer,
}
import io.iohk.midnight.midnightNtwrkWalletApi.distWalletMod as api
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel}
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.Config.InitialState
import io.iohk.midnight.wallet.core.combinator.VersionCombinator
import io.iohk.midnight.wallet.core.domain.{Address, ProvingRecipe, TokenTransfer}
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.tracing.JsWalletTracer
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.zswap.*
import org.scalablytyped.runtime.StringDictionary

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.*

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
@JSExportTopLevel("Wallet")
class JsWallet(
    versionCombinator: VersionCombinator,
    finalizer: IO[Unit],
    stopSyncing: Deferred[IO, Unit],
) extends api.Wallet {

  import Transaction.{given, *}

  override def submitTransaction(
      tx: mod.Transaction,
  ): Promise[TransactionIdentifier] =
    versionCombinator
      .submissionService(ProtocolVersion.V1)
      .flatMap(_.submitTransaction(tx))
      .map(_.txId)
      .unsafeToPromise()

  override def balanceTransaction(
      tx: mod.Transaction,
      newCoins: js.Array[mod.CoinInfo],
  ): Promise[BalanceTransactionToProve | NothingToProve] =
    versionCombinator
      .transactionService(ProtocolVersion.V1)
      .flatMap(_.balanceTransaction(tx, newCoins.toSeq))
      .map(ProvingRecipeTransformer.toApiBalanceTransactionRecipe)
      .unsafeToPromise()

  override def proveTransaction(recipe: ApiProvingRecipe): Promise[mod.Transaction] = {
    ProvingRecipeTransformer.toRecipe(recipe) match
      case Left(error) =>
        IO.raiseError(new Error(error)).unsafeToPromise()
      case Right(txRecipe) =>
        versionCombinator
          .transactionService(ProtocolVersion.V1)
          .flatMap(_.proveTransaction(txRecipe))
          .unsafeToPromise()
  }

  override def state(): Observable_[WalletState] =
    versionCombinator.state
      .map { localState =>
        val mappedWalletState = WalletState(
          availableCoins = localState.availableCoins.toJSArray,
          pendingCoins = localState.pendingCoins.toJSArray,
          balances = StringDictionary(localState.balances.map(_.map(_.toJsBigInt)).toSeq*),
          coins = localState.coins.toJSArray,
          nullifiers = localState.nullifiers.toJSArray,
          coinPublicKey = localState.coinPublicKey,
          encryptionPublicKey = localState.encryptionPublicKey,
          address = localState.address.asString,
          transactionHistory = localState.transactionHistory.map { tx =>
            TransactionHistoryEntry(
              ApplyStage.SucceedEntirely,
              StringDictionary(tx.deltas.map(_.map(_.toJsBigInt)).toSeq*),
              tx.identifiers().toJSArray,
              tx,
              tx.hash,
            )
          }.toJSArray,
        )
        val maybeProgress = (localState.syncProgress.synced, localState.syncProgress.total).tupled
        maybeProgress.fold(mappedWalletState.setSyncProgressUndefined) { (synced, total) =>
          mappedWalletState.setSyncProgress(
            SyncProgress(synced.value.toJsBigInt, total.value.toJsBigInt),
          )
        }
      }
      .unsafeToObservable()

  override def transferTransaction(
      outputs: js.Array[ApiTokenTransfer],
  ): Promise[TransactionToProve] =
    versionCombinator
      .transactionService(ProtocolVersion.V1)
      .flatMap(
        _.prepareTransferRecipe(
          outputs.toList.map((tt: ApiTokenTransfer) =>
            TokenTransfer(
              amount = tt.amount.toScalaBigInt,
              tokenType = tt.`type`,
              receiverAddress = Address(tt.receiverAddress),
            ),
          ),
        ),
      )
      .map(ProvingRecipeTransformer.toApiTransactionToProve)
      .unsafeToPromise()

  def serializeState(): Promise[String] =
    versionCombinator.serializeState.map(_.serializedState).unsafeToPromise()

  def start(): Unit =
    versionCombinator.sync.unsafeRunAndForget()

  def close(): js.Promise[Unit] =
    (stopSyncing.complete(()) >> finalizer).unsafeToPromise()
}

@JSExportTopLevel("WalletBuilder")
// $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
object JsWallet {

  @JSExport
  def build(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      seed: String,
      networkId: mod.NetworkId,
      minLogLevel: js.UndefOr[String],
      discardTxHistory: js.UndefOr[Boolean],
  ): js.Promise[api.Wallet] =
    internalBuild(
      indexerUri,
      indexerWsUri,
      proverServerUri,
      substrateNodeUri,
      seed,
      InitialState.CreateNew(NetworkId.fromJs(networkId)),
      minLogLevel.toOption,
      discardTxHistory.toOption,
    ).unsafeToPromise()

  @JSExport
  def buildFromSeed(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      seed: String,
      networkId: mod.NetworkId,
      minLogLevel: js.UndefOr[String],
      discardTxHistory: js.UndefOr[Boolean],
  ): js.Promise[api.Wallet] =
    internalBuild(
      indexerUri,
      indexerWsUri,
      proverServerUri,
      substrateNodeUri,
      seed,
      InitialState.CreateNew(NetworkId.fromJs(networkId)),
      minLogLevel.toOption,
      discardTxHistory.toOption,
    ).unsafeToPromise()

  @JSExport
  def restore(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      seed: String,
      serializedState: String,
      minLogLevel: js.UndefOr[String],
      discardTxHistory: js.UndefOr[Boolean],
  ): js.Promise[api.Wallet] =
    internalBuild(
      indexerUri,
      indexerWsUri,
      proverServerUri,
      substrateNodeUri,
      seed,
      InitialState.SerializedSnapshot(serializedState),
      minLogLevel.toOption,
      discardTxHistory.toOption,
    ).unsafeToPromise()

  private def internalBuild(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      seed: String,
      initialState: InitialState,
      minLogLevel: Option[String],
      discardTxHistory: Option[Boolean],
  ): IO[api.Wallet] = {
    val rawConfig =
      RawConfig(
        indexerUri,
        indexerWsUri,
        proverServerUri,
        substrateNodeUri,
        seed,
        initialState,
        discardTxHistory,
        minLogLevel,
      )

    for {
      minLogLevel <- IO.fromEither(
        TracerCarrier
          .parseLogLevel(rawConfig.minLogLevel)
          .leftMap(Config.ParseError.InvalidLogLevel.apply),
      )
      jsWalletTracer = buildJsWalletTracer(minLogLevel)
      _ <- jsWalletTracer.jsWalletBuildRequested(rawConfig)
      config <- parseConfig(rawConfig, jsWalletTracer)
      allocatedVersionCombinator <-
        new WalletBuilder[mod.LocalStateNoKeys, mod.Transaction]
          .build(config)
          .allocated
      (versionCombinator, finalizer) = allocatedVersionCombinator
      deferred <- Deferred[IO, Unit]
    } yield JsWallet(
      versionCombinator,
      finalizer,
      deferred,
    )
  }

  private def buildJsWalletTracer(minLogLevel: LogLevel): JsWalletTracer =
    JsWalletTracer.from(ConsoleTracer.contextAware(minLogLevel))

  private def parseConfig(rawConfig: RawConfig, jsWalletTracer: JsWalletTracer): IO[Config] =
    IO
      .fromEither(Config.parse(rawConfig))
      .attemptTap {
        case Right(config) => jsWalletTracer.configConstructed(config)
        case Left(t)       => jsWalletTracer.invalidConfig(t)
      }

  def apply(
      versionCombinator: VersionCombinator,
      finalizer: IO[Unit],
      deferred: Deferred[IO, Unit],
  ): JsWallet =
    new JsWallet(versionCombinator, finalizer, deferred)

  @JSExport
  def calculateCost(tx: mod.Transaction): js.BigInt = {
    import io.iohk.midnight.wallet.zswap.given
    WalletStateService.calculateCost[mod.Transaction, mod.TokenType](tx).toJsBigInt
  }

  @JSExport
  def generateInitialState(networkId: mod.NetworkId): String = {
    given NetworkId = NetworkId.fromJs(networkId)
    val snapshots = new SnapshotInstances[mod.LocalStateNoKeys, mod.Transaction]
    import snapshots.given
    snapshots.create.serialize
  }
}
