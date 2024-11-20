package io.iohk.midnight.wallet.engine

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, Transaction}
import io.iohk.midnight.wallet.core.services.SyncService
import io.iohk.midnight.wallet.indexer.IndexerClient
import io.iohk.midnight.wallet.zswap

import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}
import scala.scalajs.js

@JSExportTopLevel("DefaultSyncServiceInstance")
@JSExportAll
class DefaultSyncService[ESK](indexerClient: IndexerClient, esk: ESK, index: Option[BigInt])(using
    s: zswap.EncryptionSecretKey[ESK, ?],
    n: zswap.NetworkId,
) extends SyncService {
  override def sync(offset: Option[Transaction.Offset]): Stream[IO, IndexerEvent] = {
    indexerClient.viewingUpdates(esk.serialize, index)
  }

  def sync$(offset: js.UndefOr[Transaction.Offset]): Observable_[IndexerEvent] =
    sync(offset.toOption).unsafeToObservable()
}
@JSExportAll
@JSExportTopLevel("DefaultSyncService")
object DefaultSyncService {
  def create[ESK](
      indexerClient: IndexerClient,
      esk: ESK,
      index: js.UndefOr[js.BigInt],
      s: zswap.EncryptionSecretKey[ESK, ?],
      n: zswap.NetworkId,
  ): DefaultSyncService[ESK] = {
    given zswap.EncryptionSecretKey[ESK, ?] = s
    given zswap.NetworkId = n
    new DefaultSyncService[ESK](
      indexerClient,
      esk,
      index.toOption.map(v => BigInt(v.toString(10))),
    )
  }
}
