package io.iohk.midnight.wallet.jnr

import io.iohk.midnight.wallet.jnr.Ledger.ApplyResult
import jnr.ffi.Pointer

import java.nio.charset.StandardCharsets
import scala.util.Try

class LedgerImpl(ledgerAPI: LedgerAPI) extends Ledger {

  override def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): LedgerResult = {
    val rawResultCode = ledgerAPI.is_transaction_relevant(
      tx.getBytes(StandardCharsets.UTF_8),
      tx.length,
      encryptionKeySerialized.getBytes(StandardCharsets.UTF_8),
      encryptionKeySerialized.length,
    )

    LedgerResult(rawResultCode)
  }

  override def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[Throwable, ApplyResult] = {
    val maybeResult = for {
      resultPointer <- tryApplyTransactionToState(tx, localState)
      applyResult <- ApplyResult(resultPointer).toTry
      _ <- tryFreeApplyResult(applyResult)
    } yield applyResult

    maybeResult.toEither
  }

  private def tryFreeApplyResult(applyResult: ApplyResult) = Try {
    ledgerAPI.free_apply_result(applyResult.pointer)
  }

  private def tryApplyTransactionToState(tx: String, localState: String): Try[Pointer] = Try {
    ledgerAPI.apply_transaction_to_state(
      tx.getBytes(StandardCharsets.UTF_8),
      tx.length,
      local_state = localState.getBytes(StandardCharsets.UTF_8),
      local_state_len = localState.length,
    )
  }
}
