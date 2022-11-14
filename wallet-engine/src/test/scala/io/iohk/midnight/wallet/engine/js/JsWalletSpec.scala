package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite
import typings.midnightLedger.mod.Transaction

trait JsWalletFixtures {
  val txs = Seq.empty[Transaction]
  val jsWallet: JsWallet =
    new JsWallet(
      new WalletStateStub(),
      new WalletFilterServiceStub(txs),
      new WalletTxSubmissionStub(),
      IO.unit,
    )
  val jsFailingWallet: JsWallet =
    new JsWallet(
      new WalletStateStub(),
      new WalletFilterServiceFailingStub(txs, new RuntimeException("error")),
      new WalletTxSubmissionStub(),
      IO.unit,
    )
  val jsInfiniteWallet: JsWallet =
    new JsWallet(
      new WalletStateStub(),
      new WalletFilterServiceInfiniteStub(),
      new WalletTxSubmissionStub(),
      IO.unit,
    )
}

class JsWalletSpec extends CatsEffectSuite with JsWalletFixtures with BetterOutputSuite {}
