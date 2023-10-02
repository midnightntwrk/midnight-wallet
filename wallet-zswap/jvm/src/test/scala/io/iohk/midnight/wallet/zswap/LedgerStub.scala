package io.iohk.midnight.wallet.zswap

import cats.syntax.eq.*
import io.iohk.midnight.wallet.jnr.Ledger.{TxAppliedSuccessfully, TxApplyError}
import io.iohk.midnight.wallet.jnr.{Ledger, LedgerError, LedgerResult, LedgerSuccess}
import io.iohk.midnight.wallet.zswap.LedgerStub.*
import java.nio.charset.StandardCharsets

class LedgerStub extends Ledger {
  override def isTransactionRelevant(tx: String, encryptionKeySerialized: String): LedgerResult =
    if (tx === TxRelevant) LedgerSuccess.OperationTrue
    else if (tx === TxNotRelevant) LedgerSuccess.OperationFalse
    else if (tx === TxUnknown) LedgerResult.UnknownCode(1)
    else LedgerError.StateError

  @SuppressWarnings(Array("org.wartremover.warts.Null"))
  override def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[Throwable, Ledger.ApplyResult] =
    if (tx === ValidTx) Right(TxAppliedSuccessfully(AppliedTxState, null))
    else if (tx === ValidTxNoData) Right(TxApplyError(LedgerError.TransactionError, null))
    else Left(Exception("fail!"))
}

object LedgerStub {
  val TxRelevant = HexUtil.encodeHex("relevant".getBytes(StandardCharsets.UTF_8))
  val TxNotRelevant = HexUtil.encodeHex("not-relevant".getBytes(StandardCharsets.UTF_8))
  val TxUnknown = HexUtil.encodeHex("unknown-code".getBytes(StandardCharsets.UTF_8))

  val ValidTx = HexUtil.encodeHex("test-tx".getBytes(StandardCharsets.UTF_8))
  val ValidTxNoData = HexUtil.encodeHex("test-tx-no-data".getBytes(StandardCharsets.UTF_8))
  val AppliedTxState = HexUtil.encodeHex("well done".getBytes(StandardCharsets.UTF_8))
}
