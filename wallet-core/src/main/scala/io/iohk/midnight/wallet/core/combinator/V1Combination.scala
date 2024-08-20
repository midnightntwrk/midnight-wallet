package io.iohk.midnight.wallet.core.combinator

import cats.ApplicativeThrow
import cats.effect.{Async, Deferred}
import cats.syntax.all.*
import fs2.{Pipe, Stream}
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, ProtocolVersion, Transaction}
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.{Wallet, WalletStateContainer, WalletStateService}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.HexUtil
import scala.util.{Failure, Success, Try}

final class V1Combination[F[_]: Async](
    initialState: Wallet.Snapshot,
    syncService: SyncService[F],
    stateContainer: WalletStateContainer[F, Wallet],
    stateService: WalletStateService[F, Wallet],
    deferred: Deferred[F, Unit],
)(using WalletTxHistory[Wallet, zswap.Transaction], zswap.NetworkId)
    extends VersionCombination[F] {
  override def sync: F[Unit] =
    syncService
      .sync(initialState.offset)
      .interruptWhen(deferred.get.attempt)
      .takeWhile(isSupported)
      .through(deserializeIndexerEvent)
      .evalMap(updateState)
      .compile
      .drain

  private def deserializeIndexerEvent: Pipe[F, IndexerEvent, IndexerUpdate] =
    _.evalMap {
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
  ): Try[ViewingUpdate] =
    rawUpdates
      .traverse {
        case IndexerEvent.SingleUpdate.MerkleTreeCollapsedUpdate(version, mt) =>
          for {
            decoded <- HexUtil.decodeHex(mt)
            mtcu <- zswap.MerkleTreeCollapsedUpdate.deserialize(decoded)(using version)
          } yield (version, mtcu.asLeft)
        case IndexerEvent.SingleUpdate.RawTransaction(version, _, raw, applyStage) =>
          for {
            decoded <- HexUtil.decodeHex(raw)
            tx <- Try(zswap.Transaction.deserialize(decoded)(using version))
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

  private def updateState(update: IndexerUpdate): F[Unit] =
    stateContainer.updateStateEither(_.apply(update)).rethrow.void

  private def isSupported(event: IndexerEvent): Boolean =
    event match {
      case _: IndexerEvent.RawProgressUpdate | IndexerEvent.ConnectionLost => true
      case IndexerEvent.RawViewingUpdate(_, updates) =>
        updates.forall(_.protocolVersion === ProtocolVersion.V1)
    }

  override def state: Stream[F, WalletStateService.State] =
    stateService.state

  override def serializeState: F[WalletStateService.SerializedWalletState] =
    stateService.serializeState
}
