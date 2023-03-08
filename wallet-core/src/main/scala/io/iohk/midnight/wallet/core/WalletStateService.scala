package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.{Transaction, ZSwapCoinPublicKey}
import io.iohk.midnight.wallet.core.capabilities.{WalletBalances, WalletKeys}

import scala.scalajs.js

trait WalletStateService[F[_], TWallet] {
  def publicKey(implicit walletKeys: WalletKeys[TWallet, ZSwapCoinPublicKey]): F[ZSwapCoinPublicKey]

  def balance(implicit walletBalances: WalletBalances[TWallet]): Stream[F, js.BigInt]
}

object WalletStateService {
  class Live[F[_], TWallet](walletQueryStateService: WalletQueryStateService[F, TWallet])
      extends WalletStateService[F, TWallet] {

    override def publicKey(implicit
        walletKeys: WalletKeys[TWallet, ZSwapCoinPublicKey],
    ): F[ZSwapCoinPublicKey] =
      walletQueryStateService.queryOnce(wallet => walletKeys.publicKey(wallet))

    override def balance(implicit walletBalances: WalletBalances[TWallet]): Stream[F, js.BigInt] =
      walletQueryStateService.queryStream(wallet => walletBalances.balance(wallet))
  }

  def calculateCost(tx: Transaction): js.BigInt =
    tx.imbalances().map(_.imbalance).combineAll(sum)
}
