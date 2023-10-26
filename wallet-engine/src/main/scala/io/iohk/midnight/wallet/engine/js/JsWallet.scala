package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.midnightWalletApi.distTypesMod.{
  BalanceTransactionToProve,
  NothingToProve,
  TransactionHistoryEntry,
  TransactionIdentifier,
  TransactionToProve,
  WalletState,
  ProvingRecipe as ApiProvingRecipe,
  TokenTransfer as ApiTokenTransfer,
}
import io.iohk.midnight.midnightWalletApi.{distTypesMod, distWalletMod as api}
import io.iohk.midnight.midnightZswap.mod
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel}
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.domain.{Address, ProvingRecipe, TokenTransfer}
import io.iohk.midnight.wallet.engine.WalletBuilder.AllocatedWallet
import io.iohk.midnight.wallet.engine.config.{Config, RawConfig}
import io.iohk.midnight.wallet.engine.tracing.JsWalletTracer
import io.iohk.midnight.wallet.engine.{WalletBuilder, WalletSyncService}
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
    walletSyncService: WalletSyncService[IO],
    walletStateService: WalletStateService[IO, Wallet],
    walletTxSubmissionService: WalletTxSubmissionService[IO],
    walletTransactionService: WalletTransactionService[IO],
    finalizer: IO[Unit],
) extends api.Wallet {

  override def submitTransaction(
      tx: mod.Transaction,
  ): Promise[TransactionIdentifier] =
    walletTxSubmissionService
      .submitTransaction(Transaction.fromJs(tx))
      .map(_.txId)
      .unsafeToPromise()

  override def balanceTransaction(
      tx: mod.Transaction,
      newCoins: js.Array[mod.CoinInfo],
  ): Promise[BalanceTransactionToProve | NothingToProve] =
    walletTransactionService
      .balanceTransaction(Transaction.fromJs(tx), newCoins.toSeq.map(CoinInfo.fromJs))
      .map(ProvingRecipeTransformer.toApiBalanceTransactionRecipe)
      .unsafeToPromise()

  override def proveTransaction(recipe: ApiProvingRecipe): Promise[mod.Transaction] = {
    ProvingRecipeTransformer.toRecipe(recipe) match
      case Left(error) =>
        IO.raiseError(new Error(error)).unsafeToPromise()
      case Right(txRecipe) =>
        walletTransactionService
          .proveTransaction(txRecipe)
          .map(_.toJs)
          .unsafeToPromise()
  }

  override def state(): Observable_[WalletState] =
    walletStateService.state
      .map { localState =>
        WalletState(
          availableCoins = localState.availableCoins.map(_.toJs).toJSArray,
          balances = StringDictionary(localState.balances.map(_.map(_.toJsBigInt)).toSeq*),
          coins = localState.coins.map(_.toJs).toJSArray,
          coinPublicKey = localState.coinPublicKey,
          encryptionPublicKey = localState.encryptionPublicKey,
          address = localState.address.asString,
          transactionHistory = localState.transactionHistory.map { tx =>
            TransactionHistoryEntry(
              StringDictionary(tx.deltas.map(_.map(_.toJsBigInt)).toSeq*),
              tx.identifiers.toJSArray,
              tx.toJs,
              tx.hash,
            )
          }.toJSArray,
        )
      }
      .unsafeToObservable()

  override def transferTransaction(
      outputs: js.Array[ApiTokenTransfer],
  ): Promise[TransactionToProve] =
    walletTransactionService
      .prepareTransferRecipe(
        outputs.toList.map((tt: ApiTokenTransfer) =>
          TokenTransfer(
            amount = tt.amount.toScalaBigInt,
            tokenType = TokenType(tt.`type`),
            receiverAddress = Address(tt.receiverAddress),
          ),
        ),
      )
      .map(ProvingRecipeTransformer.toApiTransactionToProve)
      .unsafeToPromise()

  def start(): Unit =
    walletSyncService.updates.compile.drain.unsafeRunAndForget()

  def close(): js.Promise[Unit] =
    finalizer.unsafeRunSyncToPromise()
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
      initialState: js.UndefOr[String],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    internalBuild(
      indexerUri,
      indexerWsUri,
      proverServerUri,
      substrateNodeUri,
      initialState.toOption,
      None,
      minLogLevel.toOption,
    )
      .unsafeToPromise()

  @JSExport
  def buildFromSeed(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      seed: String,
      minLogLevel: js.UndefOr[String],
  ): js.Promise[api.Wallet] =
    internalBuildFromSeed(
      indexerUri,
      indexerWsUri,
      proverServerUri,
      substrateNodeUri,
      seed,
      minLogLevel.toOption,
    )
      .unsafeToPromise()

  private def internalBuildFromSeed(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      seed: String,
      minLogLevel: Option[String],
  ): IO[api.Wallet] = {
    IO.fromEither(LedgerSerialization.fromSeed(seed))
      .flatMap(state =>
        internalBuild(
          indexerUri,
          indexerWsUri,
          proverServerUri,
          substrateNodeUri,
          Some(LedgerSerialization.serializeState(state)),
          None,
          minLogLevel,
        ),
      )
  }

  private def internalBuild(
      indexerUri: String,
      indexerWsUri: String,
      proverServerUri: String,
      substrateNodeUri: String,
      initialState: Option[String],
      blockHeight: Option[BigInt],
      minLogLevel: Option[String],
  ): IO[api.Wallet] = {
    val rawConfig =
      RawConfig(
        indexerUri,
        indexerWsUri,
        proverServerUri,
        substrateNodeUri,
        initialState,
        blockHeight,
        minLogLevel,
      )

    for {
      _ <- jsWalletTracer.jsWalletBuildRequested(rawConfig)
      config <- parseConfig(rawConfig)
      allocatedWallet <- WalletBuilder.build[IO](config)
    } yield JsWallet(allocatedWallet)
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
      wallet.dependencies.walletSyncService,
      wallet.dependencies.walletStateService,
      wallet.dependencies.walletTxSubmissionService,
      wallet.dependencies.walletTransactionService,
      wallet.finalizer,
    )

  @JSExport
  def calculateCost(tx: Transaction): js.BigInt =
    WalletStateService.calculateCost(tx).toJsBigInt

  @JSExport
  def generateInitialState(): String =
    LedgerSerialization.serializeState(LocalState())
}
