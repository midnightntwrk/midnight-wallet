package io.iohk.midnight.wallet.engine

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, Transaction}
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.indexer.IndexerClient

import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}
import scala.scalajs.js

@JSExportTopLevel("DefaultSyncServiceInstance")
@JSExportAll
class DefaultSyncService(indexerClient: IndexerClient, bech32mESK: String, index: Option[BigInt])
    extends SyncService {
  override def sync(offset: Option[Transaction.Offset]): Stream[IO, IndexerEvent] = {
    indexerClient.viewingUpdates(bech32mESK, index)
  }

  def sync$(offset: js.UndefOr[Transaction.Offset]): Observable_[IndexerEvent] =
    sync(offset.toOption).unsafeToObservable()
}
@JSExportAll
@JSExportTopLevel("DefaultSyncService")
object DefaultSyncService {
  def create(
      indexerClient: IndexerClient,
      bech32mESK: String,
      index: js.UndefOr[js.BigInt],
  ): DefaultSyncService = {
    new DefaultSyncService(
      indexerClient,
      bech32mESK,
      index.toOption.map(v => BigInt(v.toString(10))),
    )
  }
}
