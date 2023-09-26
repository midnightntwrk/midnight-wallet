package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletKeysSpec[TWallet, TPublicKey, TViewingKey] extends BetterOutputSuite {

  val walletKeys: WalletKeys[TWallet, TPublicKey, TViewingKey]
  val walletWithKeys: TWallet
  val expectedPublicKey: TPublicKey
  val comparePublicKeys: (TPublicKey, TPublicKey) => Boolean
  val expectedViewingKey: TViewingKey
  val compareViewingKeys: (TViewingKey, TViewingKey) => Boolean

  test("return wallet public key") {
    assert(comparePublicKeys(walletKeys.publicKey(walletWithKeys), expectedPublicKey))
  }

  test("return wallet viewing key") {
    assert(compareViewingKeys(walletKeys.viewingKey(walletWithKeys), expectedViewingKey))
  }

}
