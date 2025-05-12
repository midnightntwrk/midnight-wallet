package io.iohk.midnight.wallet.integration_tests.core.capabilities

import io.iohk.midnight.wallet.core.capabilities.WalletKeys
import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletKeysSpec[TWallet, TCoinPubKey, TEncPubKey, TViewingKey] extends BetterOutputSuite {

  val walletKeys: WalletKeys[TWallet, TCoinPubKey, TEncPubKey, TViewingKey]
  val walletWithKeys: TWallet
  val expectedViewingKey: TViewingKey
  val compareViewingKeys: (TViewingKey, TViewingKey) => Boolean

  test("return wallet viewing key") {
    assert(compareViewingKeys(walletKeys.viewingKey(walletWithKeys), expectedViewingKey))
  }

}
