package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite

trait JsWalletFixtures {
  val blocks = Seq.empty[Block]
  val jsWallet: JsWallet =
    new JsWallet(new WalletSyncStub(blocks), IO.unit)
  val jsFailingWallet: JsWallet =
    new JsWallet(new WalletSyncFailingStub(blocks, new RuntimeException("error")), IO.unit)
  val jsInfiniteWallet: JsWallet =
    new JsWallet(new WalletSyncInfiniteStub, IO.unit)
}

class JsWalletSpec extends CatsEffectSuite with JsWalletFixtures with BetterOutputSuite {}
