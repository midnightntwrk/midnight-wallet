package io.iohk.midnight.wallet.core.combinator

import cats.ApplicativeThrow
import cats.effect.{Async, Deferred, Resource}
import cats.effect.syntax.all.*
import cats.syntax.all.*
import fs2.{Pipe, Stream}
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, ProtocolVersion, Transaction}
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.capabilities.{WalletTxBalancing, WalletTxHistory}
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.{ProvingService, SyncService, TxSubmissionService}
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.{HexUtil, given}
import scala.util.{Failure, Success, Try}
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.tracing.{WalletTxServiceTracer, WalletTxSubmissionTracer}
import V1Combination.walletInstances.given

final class V1Combination[F[_]: Async](
    initialState: Wallet[v1.LocalState, v1.Transaction],
    syncService: SyncService[F],
    stateContainer: WalletStateContainer[F, Wallet[v1.LocalState, v1.Transaction]],
    val stateService: WalletStateService[
      F,
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
      F,
      v1.UnprovenTransaction,
      v1.Transaction,
      v1.CoinInfo,
      v1.TokenType,
    ],
    submissionService: WalletTxSubmissionService[F, v1.Transaction],
    deferred: Deferred[F, Unit],
)(using
    WalletTxHistory[Wallet[v1.LocalState, v1.Transaction], v1.Transaction],
    zswap.NetworkId,
) extends VersionCombination[F] {

  override def sync: F[Unit] =
    syncService
      .sync(initialState.offset)
      .interruptWhen(deferred.get.attempt)
      .takeWhile(isSupported)
      .through(deserializeIndexerEvent)
      .evalMap(updateState)
      .compile
      .drain

  private def deserializeIndexerEvent
      : Pipe[F, IndexerEvent, IndexerUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction]] =
    _.evalMap[F, IndexerUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction]] {
      case IndexerEvent.RawViewingUpdate(offset, rawUpdates) =>
        ApplicativeThrow[F].fromTry(
          deserializeViewingUpdate(rawUpdates, Transaction.Offset(offset)),
        )
      case IndexerEvent.RawProgressUpdate(synced, total) =>
        ProgressUpdate(Transaction.Offset(synced), Transaction.Offset(total)).pure[F]
      case IndexerEvent.ConnectionLost =>
        ConnectionLost.pure
    }

  private def deserializeViewingUpdate(
      rawUpdates: Seq[IndexerEvent.SingleUpdate],
      offset: Transaction.Offset,
  )(using
      c: zswap.MerkleTreeCollapsedUpdate[v1.MerkleTreeCollapsedUpdate, ?],
      t: zswap.Transaction.IsSerializable[v1.Transaction],
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

  private def updateState(
      update: IndexerUpdate[v1.MerkleTreeCollapsedUpdate, v1.Transaction],
  ): F[Unit] =
    stateContainer.updateStateEither(_.apply(update)).rethrow.void

  private def isSupported(event: IndexerEvent): Boolean =
    event match {
      case _: IndexerEvent.RawProgressUpdate | IndexerEvent.ConnectionLost => true
      case IndexerEvent.RawViewingUpdate(_, updates) =>
        updates.forall(_.protocolVersion === initialState.protocolVersion)
    }

  override def state: Stream[F, stateService.TState] =
    stateService.state

  override def serializeState: F[WalletStateService.SerializedWalletState] =
    stateService.serializeState

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): F[WalletTransactionService[
    F,
    v1.UnprovenTransaction,
    v1.Transaction,
    v1.CoinInfo,
    v1.TokenType,
  ]] =
    if (initialState.protocolVersion === protocolVersion) txService.pure[F]
    else Exception(s"No transaction service available for protocol $protocolVersion").raiseError

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): F[WalletTxSubmissionService[F, v1.Transaction]] =
    if (initialState.protocolVersion === protocolVersion) submissionService.pure[F]
    else Exception(s"No submission service available for protocol $protocolVersion").raiseError
}

object V1Combination {
  type TWallet = Wallet[v1.LocalState, v1.Transaction]

  type WalletBalancing =
    WalletTxBalancing[TWallet, v1.Transaction, v1.UnprovenTransaction, v1.CoinInfo, v1.TokenType]
  type WalletTxService[F[_]] =
    WalletTransactionService[F, v1.UnprovenTransaction, v1.Transaction, v1.CoinInfo, v1.TokenType]

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

  def apply[F[_]: Async](
      config: Config,
      submissionServiceFactory: Resource[F, TxSubmissionService[F, v1.Transaction]],
      provingServiceFactory: Resource[F, ProvingService[F, v1.UnprovenTransaction, v1.Transaction]],
      syncServiceFactory: (v1.EncryptionSecretKey, Option[BigInt]) => Resource[F, SyncService[F]],
  )(using Tracer[F, StructuredLog], zswap.NetworkId): Resource[F, V1Combination[F]] =
    given WalletTxHistory[TWallet, v1.Transaction] =
      if config.discardTxHistory then walletInstances.walletDiscardTxHistory
      else walletInstances.walletTxHistory
    for {
      initialWallet <- parseInitialState(config.initialState).liftTo[F].toResource
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
          F,
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
      deferred <- Resource.make(Deferred[F, Unit])(_.complete(()).void)
    } yield new V1Combination[F](
      initialWallet,
      syncService,
      walletStateContainer,
      walletStateService,
      walletTransactionService,
      walletTxSubmissionService,
      deferred,
    )

  private def buildWalletTxSubmissionService[F[_]: Async](
      submitTxService: TxSubmissionService[F, v1.Transaction],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(using
      rootTracer: Tracer[F, StructuredLog],
      walletTxBalancing: WalletBalancing,
  ): Resource[F, WalletTxSubmissionService[F, v1.Transaction]] = {
    given WalletTxSubmissionTracer[F] = WalletTxSubmissionTracer.from(rootTracer)
    Resource.pure(
      new WalletTxSubmissionServiceFactory[F, TWallet, v1.Transaction]
        .create(submitTxService, walletStateContainer),
    )
  }

  private def buildWalletTransactionService[F[_]: Async](
      walletStateContainer: WalletStateContainer[F, TWallet],
      provingService: ProvingService[F, v1.UnprovenTransaction, v1.Transaction],
  )(using
      rootTracer: Tracer[F, StructuredLog],
      walletTxBalancing: WalletBalancing,
  ): Resource[F, WalletTxService[F]] = {
    given WalletTxServiceTracer[F] = WalletTxServiceTracer.from(rootTracer)
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
}
