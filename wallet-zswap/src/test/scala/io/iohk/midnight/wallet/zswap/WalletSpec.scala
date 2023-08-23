package io.iohk.midnight.wallet.zswap

import cats.effect.IO
import io.iohk.midnight.wallet.zswap.LedgerStub
import io.iohk.midnight.wallet.zswap.Wallet.LedgerException
import munit.{CatsEffectSuite, FunSuite}

class WalletSpec extends CatsEffectSuite {
  val ledgerStub = new LedgerStub

  test("Return true when transaction is relevant") {
    val wallet = Wallet.build[IO](ledgerStub, ViewingKey(""), WalletLocalState(""))
    wallet.isRelevant(Transaction(LedgerStub.TxRelevant)).assertEquals(true)
  }

  test("Return false when transaction is not relevant") {
    val wallet = Wallet.build[IO](ledgerStub, ViewingKey(""), WalletLocalState(""))
    wallet.isRelevant(Transaction(LedgerStub.TxNotRelevant)).assertEquals(false)
  }

  test("Return true when transaction is relevant") {
    val wallet = Wallet.build[IO](ledgerStub, ViewingKey(""), WalletLocalState(""))
    interceptIO[LedgerException](wallet.isRelevant(Transaction(LedgerStub.TxUnknown)))
  }

  test("Apply transaction successfully") {
    val wallet = Wallet.build[IO](ledgerStub, ViewingKey(""), WalletLocalState(""))
    wallet
      .apply(Transaction(LedgerStub.ValidTx))
      .flatMap(_.getState)
      .assertEquals(WalletLocalState(LedgerStub.AppliedTxState))
  }

  test("Fail if apply returns None") {
    val wallet = Wallet.build[IO](ledgerStub, ViewingKey(""), WalletLocalState(""))
    interceptIO[LedgerException](wallet.apply(Transaction(LedgerStub.ValidTxNoData)))
  }
}
