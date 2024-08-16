package io.iohk.midnight.wallet.engine.combinator

import cats.effect.{Async, Deferred, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, Transaction}
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.combinator.V1Combination
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.core.{Wallet, WalletStateContainer, WalletStateService}
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.zswap

object V1Combination {
  def apply[F[_]: Async](
      initialState: Wallet.Snapshot,
      indexerClient: Resource[F, IndexerClient[F]],
      stateContainer: WalletStateContainer[F, Wallet],
      stateService: WalletStateService[F, Wallet],
  )(using WalletTxHistory[Wallet, zswap.Transaction]): Resource[F, V1Combination[F]] = {
    indexerClient
      .evalMap { client =>
        stateService.keys.map { (_, _, esk) =>
          new SyncService[F] {
            override def sync(offset: Option[Transaction.Offset]): Stream[F, IndexerEvent] =
              client.viewingUpdates(esk.serialize, initialState.offset.map(_.value))
          }
        }
      }
      .flatMap(apply(initialState, _, stateContainer, stateService))
  }

  def apply[F[_]: Async](
      initialState: Wallet.Snapshot,
      syncService: SyncService[F],
      stateContainer: WalletStateContainer[F, Wallet],
      stateService: WalletStateService[F, Wallet],
  )(using WalletTxHistory[Wallet, zswap.Transaction]): Resource[F, V1Combination[F]] =
    Resource
      .make(Deferred[F, Unit])(_.complete(()).void)
      .map(new V1Combination[F](initialState, syncService, stateContainer, stateService, _))
}
