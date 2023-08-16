package io.iohk.midnight.wallet.jnr

import java.nio.charset.StandardCharsets
import scala.annotation.unused

class LedgerImpl(ledgerAPI: LedgerAPI) extends Ledger {

  override def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): LedgerResult = {
    val rawResultCode = ledgerAPI.is_transaction_relevant(
      tx.getBytes,
      tx.length,
      encryptionKeySerialized.getBytes(StandardCharsets.UTF_8),
      encryptionKeySerialized.length,
    )

    LedgerResult(rawResultCode)
  }

  override def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[LedgerError, String] = {
    // TODO: The signature of Rust code needs to be clarified for how to handle models, and memory management.
    @unused val result = ledgerAPI.apply_transaction_to_state(
      tx.getBytes,
      tx.length,
      local_state = "".getBytes(StandardCharsets.UTF_8),
      local_state_len = "".length,
      result = Array.emptyByteArray,
    )

    Left(LedgerError.ExcUnknown)
  }
}
