package io.iohk.midnight.wallet.core.instances

import io.iohk.midnight.wallet.core.{Snapshot, SnapshotInstances, WalletError}
import io.iohk.midnight.wallet.core.capabilities.WalletStateSerialize

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportAll
class DefaultSerializeCapability[TWallet, TAuxiliary, LocalState, Transaction](
    toSnapshot: TWallet => Snapshot[LocalState, Transaction],
    fromSnapshot: (TAuxiliary, Snapshot[LocalState, Transaction]) => TWallet,
)(using snapshotInstances: SnapshotInstances[LocalState, Transaction])
    extends WalletStateSerialize[TWallet, TAuxiliary, String] {
  import snapshotInstances.given

  extension (wallet: TWallet) override def serialize: String = toSnapshot(wallet).serialize

  override def deserialize(
      auxiliary: TAuxiliary,
      serialized: String,
  ): Either[WalletError, TWallet] = {
    Snapshot
      .deserialize(serialized)
      .map(snapshot => fromSnapshot(auxiliary, snapshot))
      .left
      .map(WalletError.SerializationError.apply)
  }
}
@JSExportTopLevel("DefaultSerializeCapability")
@JSExportAll
object DefaultSerializeCapability {
  import io.iohk.midnight.midnightNtwrkZswap.mod
  def createV1[TWallet, TAuxiliary](
      toSnapshot: js.Function1[TWallet, Snapshot[mod.LocalState, mod.Transaction]],
      fromSnapshot: js.Function2[TAuxiliary, Snapshot[mod.LocalState, mod.Transaction], TWallet],
  ): DefaultSerializeCapability[TWallet, TAuxiliary, mod.LocalState, mod.Transaction] = {
    given SnapshotInstances[mod.LocalState, mod.Transaction] =
      new SnapshotInstances[mod.LocalState, mod.Transaction]

    new DefaultSerializeCapability(toSnapshot, fromSnapshot)
  }
}
