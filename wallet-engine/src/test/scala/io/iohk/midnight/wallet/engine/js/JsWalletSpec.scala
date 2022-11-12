package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite
import typings.midnightLedger.mod.Transaction

trait JsWalletFixtures {
  val txs = Seq.empty[Transaction]
  val jsWallet: JsWallet =
    new JsWallet(new WalletSyncStub(txs), IO.unit)
  val jsFailingWallet: JsWallet =
    new JsWallet(new WalletSyncFailingStub(txs, new RuntimeException("error")), IO.unit)
  val jsInfiniteWallet: JsWallet =
    new JsWallet(new WalletSyncInfiniteStub, IO.unit)
}

class JsWalletSpec extends CatsEffectSuite with JsWalletFixtures with BetterOutputSuite {}
