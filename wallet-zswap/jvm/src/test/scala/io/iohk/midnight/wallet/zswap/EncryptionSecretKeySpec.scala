package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerError
import munit.FunSuite
import scala.util.{Failure, Success}

class EncryptionSecretKeySpec extends FunSuite {
  private val ledgerStub = new LedgerStub

  test("Return true when transaction is relevant") {
    val key = EncryptionSecretKey.deserialize("", ledgerStub)
    val result = key.test(Transaction.deserialize(LedgerStub.TxRelevant, ledgerStub))
    assertEquals(result, Success(true))
  }

  test("Return false when transaction is not relevant") {
    val key = EncryptionSecretKey.deserialize("", ledgerStub)
    val result = key.test(Transaction.deserialize(LedgerStub.TxNotRelevant, ledgerStub))
    assertEquals(result, Success(false))
  }

  test("Return error when ledger result is unknown") {
    val key = EncryptionSecretKey.deserialize("", ledgerStub)
    val result = key.test(Transaction.deserialize(LedgerStub.TxUnknown, ledgerStub))
    result match {
      case Failure(exception) => assertEquals(exception.getMessage, "Unknown code received: 1")
      case other              => fail(s"Expected failure, got $other")
    }
  }

  test("Return error when ledger execution fails") {
    val key = EncryptionSecretKey.deserialize("", ledgerStub)
    val result = key.test(Transaction.deserialize(LedgerStub.ValidTxNoData, ledgerStub))
    result match {
      case Failure(exception) =>
        assertEquals(exception.getMessage, s"Ledger error received: ${LedgerError.StateError}")
      case other => fail(s"Expected failure, got $other")
    }
  }
}
