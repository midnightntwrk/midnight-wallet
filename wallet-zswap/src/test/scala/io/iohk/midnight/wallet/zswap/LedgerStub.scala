package io.iohk.midnight.wallet.zswap

import cats.syntax.eq.*
import io.iohk.midnight.wallet.jnr.Ledger.{TxAppliedSuccessfully, TxApplyError}
import io.iohk.midnight.wallet.jnr.{Ledger, LedgerError, LedgerResult, LedgerSuccess}
import io.iohk.midnight.wallet.zswap.LedgerStub.*
import io.iohk.midnight.wallet.zswap.Wallet.LedgerException

class LedgerStub extends Ledger {
  override def isTransactionRelevant(tx: String, encryptionKeySerialized: String): LedgerResult =
    if (tx === TxRelevant) LedgerSuccess.OperationTrue
    else if (tx === TxNotRelevant) LedgerSuccess.OperationFalse
    else if (tx === TxUnknown) LedgerResult.UnknownCode(1)
    else LedgerError.StateError

  override def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[Throwable, Ledger.ApplyResult] =
    if (tx === ValidTx) Right(TxAppliedSuccessfully(AppliedTxState, null))
    else if (tx === ValidTxNoData) Right(TxApplyError(LedgerError.TransactionError, null))
    else Left(LedgerException("fail!"))
}

object LedgerStub {
  val TxRelevant = "relevant"
  val TxNotRelevant = "not-relevant"
  val TxUnknown = "unknown-code"

  val ValidTx = "test-tx"
  val ValidTxNoData = "test-tx-no-data"
  val AppliedTxState = "well done"
}
