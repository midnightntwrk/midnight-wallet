package io.iohk.midnight.wallet.engine.js

import cats.effect.unsafe.implicits.global
import cats.effect.{Deferred, IO}
import cats.syntax.all.*
import io.iohk.midnight.js.interop.TracerCarrier
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.{
  ApplyStage,
  BalanceTransactionToProve,
  NothingToProve,
  SyncLag,
  SyncProgress,
  TransactionHistoryEntry,
  TransactionIdentifier,
  TransactionToProve,
  WalletState,
  ProvingRecipe as ApiProvingRecipe,
  TokenTransfer as ApiTokenTransfer,
}
import io.iohk.midnight.midnightNtwrkWalletApi.distWalletMod as api
import io.iohk.midnight.midnightNtwrkWalletSdkAddressFormat.mod.{
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
}
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel}
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.Config.InitialState
import io.iohk.midnight.wallet.core.combinator.VersionCombinator
import io.iohk.midnight.wallet.core.instances.{DefaultTransferCapability, ProvingRecipeTransformer}
import io.iohk.midnight.wallet.core.parser.AddressParser
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.tracing.JsWalletTracer
import io.iohk.midnight.wallet.zswap.{*, given}
import org.scalablytyped.runtime.StringDictionary

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.*

/** This class delegates calls to the Scala Wallet and transforms any Scala-specific type into its
  * corresponding Javascript one
  */
@JSExportTopLevel("Wallet")
class JsWallet(
    versionCombinator: VersionCombinator,
    finalizer: IO[Unit],
    stopSyncing: Deferred[IO, Unit],
)(using networkId: NetworkId)
    extends api.Wallet {

  import Transaction.{*, given}

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
      .flatMap[BalanceTransactionToProve | NothingToProve] {
        case recipe: domain.BalanceTransactionToProve[mod.UnprovenTransaction, mod.Transaction] =>
          IO.pure(ProvingRecipeTransformer.toApiBalanceTransactionToProve(recipe))
        case recipe: domain.NothingToProve[mod.UnprovenTransaction, mod.Transaction] =>
          IO.pure(ProvingRecipeTransformer.toApiNothingToProve(recipe))
        case _: domain.TransactionToProve[mod.UnprovenTransaction] =>
          IO.raiseError(new Error("Unexpected recipe type"))
      }
      .handleErrorWith { error =>
        IO.raiseError(new Error(error))
      }
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

  override def state(): Observable_[WalletState] = {
    versionCombinator.state
      .map { localState =>
        val mappedWalletState = WalletState(
          availableCoins = localState.availableCoins.toJSArray,
          pendingCoins = localState.pendingCoins.toJSArray,
          balances = StringDictionary(localState.balances.map(_.map(_.toJsBigInt)).toSeq*),
          coins = localState.coins.toJSArray,
          nullifiers = localState.nullifiers.toJSArray,
          coinPublicKey =
            AddressParser.encodeAsBech32OrThrow[ShieldedCoinPublicKey](localState.address),
          coinPublicKeyLegacy = localState.coinPublicKey,
          encryptionPublicKey =
            AddressParser.encodeAsBech32OrThrow[ShieldedEncryptionPublicKey](localState.address),
          encryptionPublicKeyLegacy = localState.encryptionPublicKey,
          address = AddressParser.encodeAsBech32OrThrow[ShieldedAddress](localState.address),
          addressLegacy = AddressParser.encodeAsHex(localState.address),
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
        val maybeProgress = (
          localState.syncProgress.appliedIndex,
          localState.syncProgress.highestRelevantWalletIndex,
          localState.syncProgress.highestIndex,
          localState.syncProgress.highestRelevantIndex,
        )
        (maybeProgress._2, maybeProgress._3, maybeProgress._4) match {
          case (
                Some(highestRelevantWalletIndex),
                Some(highestIndex),
                Some(highestRelevantIndex),
              ) => {
            val appliedIndex = maybeProgress._1.getOrElse(Offset.Zero)
            val applyLag = (highestRelevantWalletIndex.value - appliedIndex.value).abs
            val sourceLag = (highestIndex.value - highestRelevantIndex.value).abs
            val lag = SyncLag(applyLag.toJsBigInt, sourceLag.toJsBigInt)
            val isSynced = applyLag === BigInt(0) && sourceLag <= BigInt(50)
            mappedWalletState.setSyncProgress(SyncProgress(lag, isSynced))
          }
          case _ => mappedWalletState.setSyncProgressUndefined
        }
      }
      .unsafeToObservable()
  }

  override def transferTransaction(
      outputs: js.Array[ApiTokenTransfer],
  ): Promise[TransactionToProve] = {
    (DefaultTransferCapability
      .parseApiTokenTransfers[mod.TokenType, mod.CoinPublicKey, mod.EncPublicKey](outputs) match {
      case Left(error) =>
        IO.raiseError(Exception(error.message))
      case Right(validTransfers) =>
        versionCombinator
          .transactionService(ProtocolVersion.V1)
          .flatMap(_.prepareTransferRecipe(validTransfers))
          .map(ProvingRecipeTransformer.toApiTransactionToProve)
    }).unsafeToPromise()
  }

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
        new WalletBuilder[mod.LocalState, mod.Transaction]
          .build(config)
          .allocated
      (versionCombinator, finalizer) = allocatedVersionCombinator
      deferred <- Deferred[IO, Unit]
    } yield {
      given NetworkId = versionCombinator.networkId
      JsWallet(versionCombinator, finalizer, deferred)
    }
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

  @JSExport
  def calculateCost(tx: mod.Transaction): js.BigInt = {
    WalletStateService.calculateCost[mod.Transaction, mod.TokenType](tx).toJsBigInt
  }

  @JSExport
  def generateInitialState(networkId: mod.NetworkId): String = {
    given NetworkId = NetworkId.fromJs(networkId)
    val snapshots = new SnapshotInstances[mod.LocalState, mod.Transaction]
    import snapshots.given
    snapshots.create.serialize
  }
}
