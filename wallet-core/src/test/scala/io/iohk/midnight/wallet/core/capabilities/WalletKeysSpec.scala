package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletKeysSpec[TWallet, TPublicKey] extends BetterOutputSuite {

  val walletKeys: WalletKeys[TWallet, TPublicKey]
  val walletWithKeys: TWallet
  val expectedKey: TPublicKey
  val compareKeys: (TPublicKey, TPublicKey) => Boolean

  test("return wallet public key") {
    assert(compareKeys(walletKeys.publicKey(walletWithKeys), expectedKey))
  }

}
