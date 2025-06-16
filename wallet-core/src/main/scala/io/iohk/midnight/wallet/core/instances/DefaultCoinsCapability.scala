package io.iohk.midnight.wallet.core.instances

import io.iohk.midnight.wallet.core.capabilities.WalletCoins

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("DefaultCoinsCapabilityInstance")
@JSExportAll
class DefaultCoinsCapability[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier](
    getCoins: TWallet => Seq[QualifiedCoinInfo],
    getNullifiers: TWallet => Seq[Nullifier],
    getAvailableCoins: TWallet => Seq[QualifiedCoinInfo],
    getPendingCoins: TWallet => Seq[CoinInfo],
) extends WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier] {
  extension (wallet: TWallet) {
    override def coins: Seq[QualifiedCoinInfo] = getCoins(wallet)
    override def nullifiers: Seq[Nullifier] = getNullifiers(wallet)
    override def availableCoins: Seq[QualifiedCoinInfo] = getAvailableCoins(wallet)
    override def pendingCoins: Seq[CoinInfo] = getPendingCoins(wallet)
  }
}

@JSExportTopLevel("DefaultCoinsCapability")
@JSExportAll
object DefaultCoinsCapability {
  import io.iohk.midnight.midnightNtwrkZswap.mod

  def createV1[TWallet](
      getCoins: js.Function1[TWallet, js.Array[mod.QualifiedCoinInfo]],
      getNullifiers: js.Function1[TWallet, js.Array[mod.Nullifier]],
      getAvailableCoins: js.Function1[TWallet, js.Array[mod.QualifiedCoinInfo]],
      getPendingCoins: js.Function1[TWallet, js.Array[mod.CoinInfo]],
  ): DefaultCoinsCapability[TWallet, mod.QualifiedCoinInfo, mod.CoinInfo, mod.Nullifier] = {
    def toScalaSeq[T](arr: js.Array[T]): Seq[T] = arr.toSeq
    new DefaultCoinsCapability(
      getCoins.andThen(toScalaSeq),
      getNullifiers.andThen(toScalaSeq),
      getAvailableCoins.andThen(toScalaSeq),
      getPendingCoins.andThen(toScalaSeq),
    )
  }
}
