package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.core.capabilities.WalletSync
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite

trait WalletSyncSpec[TWallet, TUpdate] extends CatsEffectSuite with BetterOutputSuite {

  val walletSync: WalletSync[TWallet, TUpdate]
  val walletForUpdates: IO[TWallet]
  val validUpdateToApply: IO[TUpdate]
  val isUpdateApplied: TWallet => Boolean

  test("apply update to the wallet") {
    walletForUpdates.product(validUpdateToApply).map { (wallet, update) =>
      val isApplied =
        walletSync
          .applyUpdate(wallet, update)
          .map(isUpdateApplied)
      assert(isApplied.getOrElse(false))
    }
  }
}
