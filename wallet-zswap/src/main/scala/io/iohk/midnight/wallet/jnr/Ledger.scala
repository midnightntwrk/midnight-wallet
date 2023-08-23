package io.iohk.midnight.wallet.jnr

import io.iohk.midnight.wallet.jnr.Ledger.ApplyResult
import io.iohk.midnight.wallet.jnr.LedgerSuccess.OperationTrue
import jnr.ffi.Pointer

trait Ledger {

  def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): LedgerResult

  def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[Throwable, ApplyResult]
}

object Ledger {
  sealed trait ApplyResult {
    private[jnr] def pointer: Pointer
  }
  final case class TxAppliedSuccessfully(updatedState: String, pointer: Pointer) extends ApplyResult
  final case class TxApplyError(ledgerError: LedgerError, pointer: Pointer) extends ApplyResult

  object ApplyResult {

    private val LEDGER_RESULT_STRUCT_OFFSET = 0
    private val LEDGER_RESULT_FIELD_SIZE = 8 // In Rust ApplyResult::ledger_result is i16 (2 bytes)

    def apply(pointer: Pointer): Either[Throwable, ApplyResult] = {
      val ledgerResult = LedgerResult(pointer.getShort(LEDGER_RESULT_STRUCT_OFFSET))

      ledgerResult match {
        case LedgerSuccess.OperationTrue =>
          val updatedState = pointer
            .getPointer(LEDGER_RESULT_FIELD_SIZE)
            .getString(0)
          Right(TxAppliedSuccessfully(updatedState, pointer))

        case error: LedgerError =>
          Right(TxApplyError(error, pointer))
        case unexpected =>
          Left(new IllegalStateException(s"Unexpected apply result received: $unexpected"))
      }
    }
  }
}
