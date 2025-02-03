package io.iohk.midnight.wallet.core.combinator

import cats.ApplicativeThrow
import cats.effect.unsafe.implicits.global
import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, ProtocolVersion, Transaction}
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.capabilities.{WalletTxBalancing, WalletTxHistory}
import io.iohk.midnight.wallet.core.combinator.V1Combination.walletInstances.given
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.{ProvingService, SyncService, TxSubmissionService}
import io.iohk.midnight.wallet.core.tracing.{WalletTxServiceTracer, WalletTxSubmissionTracer}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.{HexUtil, given}

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}
import scala.util.{Failure, Success, Try}

final class V1Combination(
    initialState: Wallet[v1.LocalState, v1.Transaction],
    syncService: SyncService,
    stateContainer: WalletStateContainer[Wallet[v1.LocalState, v1.Transaction]],
    val stateService: WalletStateService[
      v1.CoinPublicKey,
      v1.EncPublicKey,
      v1.EncryptionSecretKey,
      v1.TokenType,
      v1.QualifiedCoinInfo,
      v1.CoinInfo,
      v1.Nullifier,
      v1.Transaction,
    ],
    txService: WalletTransactionService[
      v1.UnprovenTransaction,
      v1.Transaction,
      v1.CoinInfo,
      v1.TokenType,
    ],
    submissionService: WalletTxSubmissionService[v1.Transaction],
    deferred: Deferred[IO, Unit],
)(using
    WalletTxHistory[Wallet[v1.LocalState, v1.Transaction], v1.Transaction],
    zswap.NetworkId,
) extends VersionCombination {

  override def sync: IO[Unit] =
    syncService
      .sync(initialState.offset)
      .interruptWhen(deferred.get.attempt)
      .takeWhile(isSupported)
      .evalMap(V1Combination.deserializeIndexerEvent)
      .evalMap(updateState)
      .compile
      .drain

  private def updateState(
      update: IndexerUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction],
  ): IO[Unit] =
    stateContainer.updateStateEither(_.apply(update)).rethrow.void

  private def isSupported(event: IndexerEvent): Boolean =
    event match {
      case _: IndexerEvent.RawProgressUpdate | IndexerEvent.ConnectionLost => true
      case IndexerEvent.RawViewingUpdate(_, updates) =>
        updates.forall(_.protocolVersion === initialState.protocolVersion)
    }

  override def state: Stream[IO, stateService.TState] =
    stateService.state

  override def serializeState: IO[WalletStateService.SerializedWalletState] =
    stateService.serializeState

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTransactionService[
    v1.UnprovenTransaction,
    v1.Transaction,
    v1.CoinInfo,
    v1.TokenType,
  ]] =
    if (initialState.protocolVersion === protocolVersion) txService.pure[IO]
    else Exception(s"No transaction service available for protocol $protocolVersion").raiseError

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[v1.Transaction]] =
    if (initialState.protocolVersion === protocolVersion) submissionService.pure[IO]
    else Exception(s"No submission service available for protocol $protocolVersion").raiseError
}

@JSExportTopLevel("V1Combination")
object V1Combination {
  type TWallet = Wallet[v1.LocalState, v1.Transaction]

  type WalletBalancing =
    WalletTxBalancing[TWallet, v1.Transaction, v1.UnprovenTransaction, v1.CoinInfo, v1.TokenType]
  type WalletTxService =
    WalletTransactionService[v1.UnprovenTransaction, v1.Transaction, v1.CoinInfo, v1.TokenType]

  given snapshotInstances: SnapshotInstances[v1.LocalState, v1.Transaction] =
    new SnapshotInstances

  val walletInstances: WalletInstances[
    v1.LocalState,
    v1.Transaction,
    v1.TokenType,
    v1.Offer,
    v1.ProofErasedTransaction,
    v1.QualifiedCoinInfo,
    v1.CoinInfo,
    v1.Nullifier,
    v1.CoinPublicKey,
    v1.EncryptionSecretKey,
    v1.EncPublicKey,
    v1.UnprovenInput,
    v1.ProofErasedOffer,
    v1.MerkleTreeCollapsedUpdate,
    v1.UnprovenTransaction,
    v1.UnprovenOffer,
    v1.UnprovenOutput,
  ] = new WalletInstances

  import walletInstances.given

  def apply(
      config: Config,
      submissionServiceFactory: Resource[IO, TxSubmissionService[v1.Transaction]],
      provingServiceFactory: Resource[
        IO,
        ProvingService[v1.UnprovenTransaction, v1.Transaction],
      ],
      syncServiceFactory: (v1.EncryptionSecretKey, Option[BigInt]) => Resource[IO, SyncService],
  )(using Tracer[IO, StructuredLog], zswap.NetworkId): Resource[IO, V1Combination] =
    given WalletTxHistory[TWallet, v1.Transaction] =
      if config.discardTxHistory then walletInstances.walletDiscardTxHistory
      else walletInstances.walletTxHistory
    for {
      initialWallet <- parseInitialState(config.initialState).liftTo[IO].toResource
      syncService <- syncServiceFactory(
        initialWallet.state.yesIKnowTheSecurityImplicationsOfThis_encryptionSecretKey(),
        initialWallet.offset.map(_.value),
      )
      walletStateContainer <- WalletStateContainer.Live(initialWallet)
      walletQueryStateService <- Resource.pure(
        new WalletQueryStateService.Live(walletStateContainer),
      )
      walletStateService <- Resource.pure(
        new WalletStateServiceFactory[
          TWallet,
          v1.CoinPublicKey,
          v1.EncPublicKey,
          v1.EncryptionSecretKey,
          v1.TokenType,
          v1.QualifiedCoinInfo,
          v1.CoinInfo,
          v1.Nullifier,
          v1.Transaction,
        ].create(walletQueryStateService),
      )
      submitTxService <- submissionServiceFactory
      provingService <- provingServiceFactory
      walletTxSubmissionService <- buildWalletTxSubmissionService(
        submitTxService,
        walletStateContainer,
      )
      walletTransactionService <- buildWalletTransactionService(
        walletStateContainer,
        provingService,
      )
      deferred <- Resource.make(Deferred[IO, Unit])(_.complete(()).void)
    } yield new V1Combination(
      initialWallet,
      syncService,
      walletStateContainer,
      walletStateService,
      walletTransactionService,
      walletTxSubmissionService,
      deferred,
    )

  private def buildWalletTxSubmissionService(
      submitTxService: TxSubmissionService[v1.Transaction],
      walletStateContainer: WalletStateContainer[TWallet],
  )(using
      rootTracer: Tracer[IO, StructuredLog],
      walletTxBalancing: WalletBalancing,
  ): Resource[IO, WalletTxSubmissionService[v1.Transaction]] = {
    given WalletTxSubmissionTracer = WalletTxSubmissionTracer.from(rootTracer)
    Resource.pure(
      new WalletTxSubmissionServiceFactory[TWallet, v1.Transaction]
        .create(submitTxService, walletStateContainer),
    )
  }

  private def buildWalletTransactionService(
      walletStateContainer: WalletStateContainer[TWallet],
      provingService: ProvingService[v1.UnprovenTransaction, v1.Transaction],
  )(using
      rootTracer: Tracer[IO, StructuredLog],
      walletTxBalancing: WalletBalancing,
  ): Resource[IO, WalletTxService] = {
    given WalletTxServiceTracer = WalletTxServiceTracer.from(rootTracer)
    Resource.pure(
      new WalletTransactionServiceFactory().create(walletStateContainer, provingService),
    )
  }

  def parseInitialState(initialState: Config.InitialState): Either[Throwable, TWallet] =
    (initialState match
      case Config.InitialState.CreateNew(networkId) =>
        given zswap.NetworkId = networkId
        snapshotInstances.create.asRight
      case Config.InitialState.Seed(seed, networkId) =>
        given zswap.NetworkId = networkId
        snapshotInstances.fromSeed(seed)
      case Config.InitialState.SerializedSnapshot(serialized) =>
        snapshotInstances.parse(serialized)
    )
      .map(walletInstances.walletCreation.create)

  @JSExport def mapIndexerEvent(
      event: IndexerEvent,
      n: zswap.NetworkId,
  ): js.Promise[IndexerUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction]] = {
    given zswap.NetworkId = n
    deserializeIndexerEvent(event).unsafeToPromise()
  }

  def deserializeIndexerEvent(
      event: IndexerEvent,
  )(using n: zswap.NetworkId): IO[IndexerUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction]] = {
    event match {
      case IndexerEvent.RawViewingUpdate(offset, rawUpdates) =>
        ApplicativeThrow[IO].fromTry(
          deserializeViewingUpdate(rawUpdates, Transaction.Offset(offset)),
        )
      case IndexerEvent.RawProgressUpdate(synced, total) =>
        ProgressUpdate(Transaction.Offset(synced), Transaction.Offset(total)).pure[IO]
      case IndexerEvent.ConnectionLost =>
        ConnectionLost.pure[IO]
    }
  }

  private def deserializeViewingUpdate(
      rawUpdates: Seq[IndexerEvent.SingleUpdate],
      offset: Transaction.Offset,
  )(using
      c: zswap.MerkleTreeCollapsedUpdate[v1.MerkleTreeCollapsedUpdate, ?],
      t: zswap.Transaction.IsSerializable[v1.Transaction],
      n: zswap.NetworkId,
  ): Try[ViewingUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction]] =
    rawUpdates
      .traverse {
        case IndexerEvent.SingleUpdate.MerkleTreeCollapsedUpdate(version, mt) =>
          for {
            decoded <- HexUtil.decodeHex(mt)
            mtcu <- c.deserialize(decoded)
          } yield (version, mtcu.asLeft)
        case IndexerEvent.SingleUpdate.RawTransaction(version, _, raw, applyStage) =>
          for {
            decoded <- HexUtil.decodeHex(raw)
            tx <- Try(t.deserialize(decoded))
            applyStage <- Try(ApplyStage.valueOf(applyStage))
          } yield (version, AppliedTransaction(tx, applyStage).asRight)
      }
      .flatMap { updates =>
        val updatesByVersion = updates.groupMap(_._1)(_._2).toSeq.toNeSeq
        updatesByVersion match {
          case None => Failure(Exception("Invalid empty viewing update"))
          case Some(neSeq) =>
            if (neSeq.size > 1) Failure(Exception(s"Invalid update versions: ${updates._1F}"))
            else Success(ViewingUpdate(neSeq.head._1, offset, neSeq.head._2))
        }
      }
}
