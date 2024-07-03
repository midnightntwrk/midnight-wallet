package io.iohk.midnight.wallet.integration_tests.core.capabilities

import io.iohk.midnight.wallet.core.capabilities.WalletKeys
import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletKeysSpec[TWallet, TCoinPubKey, TEncPubKey, TViewingKey] extends BetterOutputSuite {

  val walletKeys: WalletKeys[TWallet, TCoinPubKey, TEncPubKey, TViewingKey]
  val walletWithKeys: TWallet
  val expectedCoinPubKey: TCoinPubKey
  val compareCoinPubKeys: (TCoinPubKey, TCoinPubKey) => Boolean
  val expectedEncPubKey: TEncPubKey
  val compareEncPubKeys: (TEncPubKey, TEncPubKey) => Boolean
  val expectedViewingKey: TViewingKey
  val compareViewingKeys: (TViewingKey, TViewingKey) => Boolean

  test("return wallet coin public key") {
    assert(compareCoinPubKeys(walletKeys.coinPublicKey(walletWithKeys), expectedCoinPubKey))
  }

  test("return wallet encryption public key") {
    assert(compareEncPubKeys(walletKeys.encryptionPublicKey(walletWithKeys), expectedEncPubKey))
  }

  test("return wallet viewing key") {
    assert(compareViewingKeys(walletKeys.viewingKey(walletWithKeys), expectedViewingKey))
  }

}
