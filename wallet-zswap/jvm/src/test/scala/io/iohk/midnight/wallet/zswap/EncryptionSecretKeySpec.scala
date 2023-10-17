package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.LedgerError
import munit.FunSuite
import scala.util.{Failure, Success}

class EncryptionSecretKeySpec extends FunSuite {
  private val ledgerStub = new LedgerStub

  test("Return true when transaction is relevant") {
    val key = EncryptionSecretKey.deserialize(Array.emptyByteArray, ledgerStub)
    val result = for {
      decodedTx <- HexUtil.decodeHex(LedgerStub.TxRelevant)
      result <- key.test(Transaction.deserialize(decodedTx, ledgerStub))
    } yield result
    assertEquals(result, Success(true))
  }

  test("Return false when transaction is not relevant") {
    val key = EncryptionSecretKey.deserialize(Array.emptyByteArray, ledgerStub)
    val result = for {
      decodedTx <- HexUtil.decodeHex(LedgerStub.TxNotRelevant)
      result <- key.test(Transaction.deserialize(decodedTx, ledgerStub))
    } yield result
    assertEquals(result, Success(false))
  }

  test("Return error when ledger result is unknown") {
    val key = EncryptionSecretKey.deserialize(Array.emptyByteArray, ledgerStub)
    val result = for {
      decodedTx <- HexUtil.decodeHex(LedgerStub.TxUnknown)
      result <- key.test(Transaction.deserialize(decodedTx, ledgerStub))
    } yield result
    result match {
      case Failure(exception) => assertEquals(exception.getMessage, "Unknown code received: 1")
      case other              => fail(s"Expected failure, got $other")
    }
  }

  test("Return error when ledger execution fails") {
    val key = EncryptionSecretKey.deserialize(Array.emptyByteArray, ledgerStub)
    val result = for {
      decodedTx <- HexUtil.decodeHex(LedgerStub.ValidTxNoData)
      result <- key.test(Transaction.deserialize(decodedTx, ledgerStub))
    } yield result
    result match {
      case Failure(exception) =>
        assertEquals(exception.getMessage, s"Ledger error received: ${LedgerError.StateError}")
      case other => fail(s"Expected failure, got $other")
    }
  }
}
